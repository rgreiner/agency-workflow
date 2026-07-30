-- 166_horas_por_foco.sql
-- APONTAMENTO DE HORAS SEM APONTAR (regra definida pelo Rafael em 30/07/2026)
--
-- Ninguém aperta play e ninguém preenche timesheet. O tempo de envolvimento numa
-- tarefa é INFERIDO do uso normal do Flow:
--
--   abrir a tarefa A  →  (envolvimento com A)  →  abrir a tarefa B
--
-- ou seja: a sessão de A vai da abertura de A até a PRÓXIMA abertura de qualquer
-- tarefa, e é limitada pelo PONTO do dia (migrations 150/165):
--   • antes da entrada ou depois da saída não conta;
--   • dentro de uma pausa (qualquer par fechado do dia) não conta;
--   • a última tarefa aberta corre até a saída — "até finalizar o ponto, ela
--     continua trabalhando";
--   • a sessão NUNCA atravessa o dia (o expediente do dia da abertura é o teto),
--     senão a tarefa aberta às 17h50 de segunda comeria a manhã de terça.
--
-- Nada é rateado nem truncado: a régua é o intervalo cru. Os desvios (tarefa que
-- ficou aberta enquanto a pessoa fazia outra coisa) são MEDIDOS e devolvidos ao
-- lado — `sem_sinal_min` = quanto da sessão correu depois do último sinal de vida
-- da aba — pra dar contramedida, não pra corrigir o número automaticamente.
--
-- Custo: vem da folha real (rh_folha) ÷ horas do PONTO no mês. O denominador é o
-- ponto (não as horas atribuídas), então quem tem tempo não atribuído não vira
-- artificialmente "caro".
--
-- O evento gravado é BRUTO e imutável. Toda a régua acima vive em função — mudar
-- de ideia depois é reescrever a função, sem perder histórico.

-- ── Evento bruto: "fulano abriu esta tarefa agora" ───────────────────────────
create table if not exists activity_focus (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  activity_id uuid not null references activities(id) on delete cascade,
  aberta_em   timestamptz not null default now(),
  ping_em     timestamptz not null default now(),  -- último sinal de vida da aba
  origem      text,                                 -- 'modal' | 'pagina'
  created_at  timestamptz not null default now()
);
create index if not exists activity_focus_org_user_idx on activity_focus (org_id, user_id, aberta_em);
create index if not exists activity_focus_activity_idx on activity_focus (activity_id);

alter table activity_focus enable row level security;

-- Quem pode LER o evento: o próprio, a gestão (owner/admin) e o RH.
drop policy if exists activity_focus_read on activity_focus;
create policy activity_focus_read on activity_focus for select using (
  user_id = auth.uid()
  or rh_can(org_id)
  or exists (
    select 1 from organization_members m
    where m.org_id = activity_focus.org_id and m.user_id = auth.uid() and m.role in ('owner','admin')
  )
);
-- Escrita só pelas RPCs abaixo (security definer). Sem policy de insert/update.

-- ── Quem enxerga o relatório de horas: gestão OU RH ──────────────────────────
create or replace function horas_can(p_org uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select rh_can(p_org) or exists (
    select 1 from organization_members
    where org_id = p_org and user_id = auth.uid() and role in ('owner','admin')
  );
$$;
revoke execute on function horas_can(uuid) from public;
grant execute on function horas_can(uuid) to authenticated;

-- ── Registrar a abertura ─────────────────────────────────────────────────────
-- auth.uid() SEMPRE — nunca receber o usuário por parâmetro (ver auditoria 22/07).
-- Dedup de 90s: a tela dá router.refresh a cada 20s (AutoRefresh) e o React pode
-- remontar; sem isso a mesma abertura viraria N eventos e picotaria a sessão.
create or replace function registrar_foco(p_activity_id uuid, p_origem text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid; v_org uuid; v_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then return null; end if;

  select w.org_id into v_org
  from activities a
  join campaigns c on c.id = a.campaign_id
  join workspaces w on w.id = c.workspace_id
  where a.id = p_activity_id;

  if v_org is null or not is_org_member(v_org) then return null; end if;

  select id into v_id from activity_focus
  where user_id = v_uid and activity_id = p_activity_id
    and aberta_em > now() - interval '90 seconds'
  order by aberta_em desc limit 1;

  if v_id is not null then
    update activity_focus set ping_em = now() where id = v_id;
    return v_id;
  end if;

  insert into activity_focus (org_id, user_id, activity_id, origem)
  values (v_org, v_uid, p_activity_id, nullif(p_origem, ''))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function registrar_foco(uuid, text) from public;
grant execute on function registrar_foco(uuid, text) to authenticated;

-- ── Sinal de vida (a aba está aberta E visível) ──────────────────────────────
create or replace function foco_ping(p_id uuid)
returns void language sql security definer set search_path to 'public' as $$
  update activity_focus set ping_em = now() where id = p_id and user_id = auth.uid();
$$;
revoke execute on function foco_ping(uuid) from public;
grant execute on function foco_ping(uuid) to authenticated;

-- ── Motor: sessões atribuídas (base de tudo) ─────────────────────────────────
-- Sem grant a authenticated de propósito: só as funções de relatório (definer,
-- com guarda de permissão) chamam esta aqui.
create or replace function horas_sessoes(p_org uuid, p_ini date, p_fim date)
returns table (
  user_id uuid, activity_id uuid, dia date,
  inicio timestamptz, fim timestamptz, minutos numeric, sem_sinal_min numeric
)
language sql stable security definer set search_path to 'public' as $$
  with foco as (
    select f.user_id, f.activity_id, f.aberta_em, f.ping_em,
           (f.aberta_em at time zone 'America/Sao_Paulo')::date as dia,
           lead(f.aberta_em) over (partition by f.user_id order by f.aberta_em) as prox
    from activity_focus f
    where f.org_id = p_org
      and f.aberta_em >= ((p_ini::timestamp) at time zone 'America/Sao_Paulo')
      and f.aberta_em <  (((p_fim + 1)::timestamp) at time zone 'America/Sao_Paulo')
  ),
  -- Pares trabalhados do ponto: (1,2), (3,4)… A pausa fica FORA por construção.
  -- Par ainda aberto: só vale se for hoje (fecha em now()). Dia passado sem saída
  -- é descartado — melhor perder o dia do que inventar horas até a meia-noite.
  pares as (
    select c.membro_user_id as user_id, p.data as dia,
           ((p.data + m1.hora)::timestamp at time zone 'America/Sao_Paulo') as ini,
           coalesce(
             ((p.data + m2.hora)::timestamp at time zone 'America/Sao_Paulo'),
             now()
           ) as fim
    from rh_ponto p
    join rh_colaborador c on c.id = p.colaborador_id and c.membro_user_id is not null
    join rh_marcacao m1 on m1.ponto_id = p.id and (m1.seq % 2) = 1
    left join rh_marcacao m2 on m2.ponto_id = p.id and m2.seq = m1.seq + 1
    where p.org_id = p_org
      and p.data between p_ini and p_fim
      and (m2.hora is not null or p.data = (now() at time zone 'America/Sao_Paulo')::date)
  ),
  corte as (
    select f.user_id, f.activity_id, f.dia, f.ping_em,
           greatest(f.aberta_em, pr.ini) as inicio,
           least(coalesce(f.prox, 'infinity'::timestamptz), pr.fim) as fim
    from foco f
    join pares pr on pr.user_id = f.user_id and pr.dia = f.dia
  )
  select user_id, activity_id, dia, inicio, fim,
         round((extract(epoch from (fim - inicio)) / 60.0)::numeric, 2),
         round(greatest(0, extract(epoch from (fim - greatest(inicio, ping_em))) / 60.0)::numeric, 2)
  from corte
  where fim > inicio;
$$;
revoke execute on function horas_sessoes(uuid, date, date) from public;

-- ── Custo/hora por pessoa e competência (da folha real) ──────────────────────
-- custo do mês = vencimentos (bruto) + FGTS. NÃO inclui INSS patronal nem
-- provisão de 13º/férias — quando a guia virar dado estruturado, entra aqui.
--
-- Denominador = horas ÚTEIS do mês (dias da jornada, menos feriado que abona,
-- × carga diária). NÃO usar as horas já batidas: no dia 5 o mês tem 3 dias de
-- ponto e o custo/hora sairia ~10× maior (medido: R$ 580/h contra ~R$ 26/h).
-- Com denominador fixo o custo de uma tarefa também não muda conforme o mês anda.
create or replace function horas_custo_hora(p_org uuid)
returns table (user_id uuid, comp date, custo_hora numeric)
language sql stable security definer set search_path to 'public' as $$
  with folha as (
    select c.id as colaborador_id, c.membro_user_id as user_id,
           date_trunc('month', f.competencia)::date as comp,
           sum(coalesce(f.vencimentos, 0) + coalesce(f.fgts, 0)) as custo_mes,
           coalesce(
             (select j.carga_min from rh_jornada j where j.colaborador_id = c.id limit 1),
             (select j.carga_min from rh_jornada j where j.org_id = p_org and j.colaborador_id is null limit 1),
             480) as carga_min,
           coalesce(
             (select j.dias_semana from rh_jornada j where j.colaborador_id = c.id limit 1),
             (select j.dias_semana from rh_jornada j where j.org_id = p_org and j.colaborador_id is null limit 1),
             '{1,2,3,4,5}'::int[]) as dias_semana
    from rh_folha f
    join rh_colaborador c on c.id = f.colaborador_id and c.membro_user_id is not null
    where f.org_id = p_org
    group by 1, 2, 3, 5, 6
  ),
  uteis as (
    select fo.colaborador_id, fo.comp, fo.custo_mes, fo.user_id,
           (count(*) filter (
              where extract(isodow from d)::int = any (fo.dias_semana)
                and not exists (
                  select 1 from rh_feriado fe
                  where fe.org_id = p_org and fe.data = d::date and fe.abona
                )
            ) * fo.carga_min) / 60.0 as horas_mes
    from folha fo
    cross join lateral generate_series(
      fo.comp::timestamp,
      (fo.comp + interval '1 month - 1 day')::timestamp,
      interval '1 day') d
    group by 1, 2, 3, 4, fo.carga_min
  )
  select u.user_id, u.comp,
         case when u.horas_mes > 0 then round((u.custo_mes / u.horas_mes)::numeric, 2) end
  from uteis u;
$$;
revoke execute on function horas_custo_hora(uuid) from public;

-- ── Relatório por tarefa ─────────────────────────────────────────────────────
create or replace function horas_por_atividade(p_org uuid, p_ini date, p_fim date)
returns table (
  activity_id uuid, titulo text, status text,
  campanha text, cliente text, workspace_id uuid,
  estimadas numeric, minutos numeric, sem_sinal_min numeric,
  pessoas int, custo numeric
)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not horas_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  return query
  with s as (select * from horas_sessoes(p_org, p_ini, p_fim)),
  ch as (select * from horas_custo_hora(p_org))
  select a.id, a.title, a.status::text, c.name, w.name, w.id,
         a.estimated_hours,
         round(sum(s.minutos), 1),
         round(sum(s.sem_sinal_min), 1),
         count(distinct s.user_id)::int,
         case when rh_can(p_org)
              then round(sum(s.minutos / 60.0 * coalesce(ch.custo_hora, 0)), 2) end
  from s
  join activities a on a.id = s.activity_id
  join campaigns c on c.id = a.campaign_id
  join workspaces w on w.id = c.workspace_id
  left join ch on ch.user_id = s.user_id and ch.comp = date_trunc('month', s.dia)::date
  group by a.id, a.title, a.status, c.name, w.name, w.id, a.estimated_hours
  order by sum(s.minutos) desc;
end $$;
revoke execute on function horas_por_atividade(uuid, date, date) from public;
grant execute on function horas_por_atividade(uuid, date, date) to authenticated;

-- ── Relatório por pessoa (com o diagnóstico do desvio) ───────────────────────
-- min_ponto  = o que o ponto diz que a pessoa trabalhou no período
-- min_tarefa = o que a régua conseguiu atribuir a alguma tarefa
-- min_sem_tarefa = ponto − atribuído (antes da 1ª abertura do dia, ou nenhuma
--                  tarefa aberta) → é o "tempo cego", o que monitorar
create or replace function horas_por_pessoa(p_org uuid, p_ini date, p_fim date)
returns table (
  user_id uuid, nome text, min_ponto numeric, min_tarefa numeric,
  min_sem_tarefa numeric, sem_sinal_min numeric, tarefas int, custo_hora numeric
)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not horas_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  return query
  with s as (select * from horas_sessoes(p_org, p_ini, p_fim)),
  atrib as (
    select s.user_id, sum(s.minutos) as min_tarefa, sum(s.sem_sinal_min) as sem_sinal,
           count(distinct s.activity_id)::int as tarefas
    from s group by s.user_id
  ),
  ponto as (
    select c.membro_user_id as user_id, sum(p.minutos)::numeric as min_ponto
    from rh_ponto p
    join rh_colaborador c on c.id = p.colaborador_id and c.membro_user_id is not null
    where p.org_id = p_org and p.data between p_ini and p_fim
    group by 1
  ),
  ch as (
    select h.user_id, round(avg(h.custo_hora), 2) as custo_hora
    from horas_custo_hora(p_org) h
    where h.comp between date_trunc('month', p_ini)::date and date_trunc('month', p_fim)::date
    group by 1
  )
  select pt.user_id, pr.full_name,
         round(pt.min_ponto, 1),
         round(coalesce(a.min_tarefa, 0), 1),
         round(greatest(0, pt.min_ponto - coalesce(a.min_tarefa, 0)), 1),
         round(coalesce(a.sem_sinal, 0), 1),
         coalesce(a.tarefas, 0),
         case when rh_can(p_org) then ch.custo_hora end
  from ponto pt
  left join atrib a on a.user_id = pt.user_id
  left join profiles pr on pr.id = pt.user_id
  left join ch on ch.user_id = pt.user_id
  order by pt.min_ponto desc;
end $$;
revoke execute on function horas_por_pessoa(uuid, date, date) from public;
grant execute on function horas_por_pessoa(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';
