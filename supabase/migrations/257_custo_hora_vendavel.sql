-- 257_custo_hora_vendavel.sql
-- Revisão do custo/hora fechada com o Rafael em 26/08/2026 (3 decisões):
--
--  1) CUSTO PROJETADO NA FICHA (`custo_projetado_mensal`): substitui a folha no
--     cálculo do custo da pessoa. É o caso do sócio — o holerite traz R$ 1.621
--     de pró-labore e o custo real é a retirada projetada (pró-labore +
--     distribuição média). Preenchido = camadas 1–3 viram esse valor único
--     (sem FGTS/encargos/provisões por cima); benefícios da ficha ainda somam.
--     A provisão de lucro da config CONTINUA existindo — decisão "os dois
--     separados": ficha = ele executando; provisão = parcela de gestão que
--     rateia no time.
--
--  2) FLAG `custo_overhead` na ficha (cargo adm/gestão que NÃO atua em
--     tarefas): o custo mensal da pessoa vai para o pool de overhead e as
--     horas dela SAEM do denominador. Sem isso o erro era duplo — o custo não
--     redistribuía E as horas dela ainda diluíam a estrutura de todos.
--
--  3) DENOMINADOR = HORA VENDÁVEL: custo mensal ÷ horas efetivamente em
--     tarefas (medidas pela abertura, horas_sessoes), não a jornada cheia.
--     Jornada 184h com ~60% em tarefa subestimava a hora vendida. Fallback:
--     sem medição no período, vale a jornada útil (e a tela etiqueta).
--     Média normalizada pela COBERTURA da medição (o activity_focus existe
--     desde 30/07/2026 — média fixa de 3 meses dividiria por meses vazios).
--
-- horas_overhead_mes NÃO muda (estrutura + provisão de lucro); o pool de
-- pessoas-overhead é somado dentro das funções de custo, onde as camadas
-- já estão montadas. Idempotente.

-- ── Ficha ────────────────────────────────────────────────────────────────────
alter table rh_colaborador add column if not exists custo_projetado_mensal numeric;
alter table rh_colaborador add column if not exists custo_overhead boolean not null default false;

create or replace function rh_set_custo_overhead(p_colaborador uuid, p_overhead boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid;
begin
  select org_id into v_org from rh_colaborador where id = p_colaborador;
  if v_org is null then raise exception 'Colaborador não encontrado'; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  update rh_colaborador set custo_overhead = coalesce(p_overhead, false) where id = p_colaborador;
end $$;
revoke execute on function rh_set_custo_overhead(uuid, boolean) from public, anon;
grant  execute on function rh_set_custo_overhead(uuid, boolean) to authenticated;

-- rh_upsert_colaborador ganha o custo projetado (mesma assinatura da 170).
create or replace function rh_upsert_colaborador(p_org_id uuid, p_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if coalesce(nullif(p_data->>'nome',''), '') = '' then raise exception 'Nome é obrigatório'; end if;

  if p_id is null then
    insert into rh_colaborador (org_id, nome, cpf, email, telefone, cargo, tipo_vinculo,
      data_admissao, data_demissao, status, gestor_id, membro_user_id, salario_atual,
      beneficios_mensal, custo_projetado_mensal, observacao, created_by)
    values (p_org_id,
      p_data->>'nome', nullif(p_data->>'cpf',''), nullif(p_data->>'email',''), nullif(p_data->>'telefone',''),
      nullif(p_data->>'cargo',''), nullif(p_data->>'tipo_vinculo',''),
      nullif(p_data->>'data_admissao','')::date, nullif(p_data->>'data_demissao','')::date,
      coalesce(nullif(p_data->>'status',''), 'ativo'),
      nullif(p_data->>'gestor_id','')::uuid, nullif(p_data->>'membro_user_id','')::uuid,
      nullif(p_data->>'salario_atual','')::numeric,
      coalesce(nullif(p_data->>'beneficios_mensal','')::numeric, 0),
      nullif(p_data->>'custo_projetado_mensal','')::numeric,
      nullif(p_data->>'observacao',''), auth.uid())
    returning id into v_id;
  else
    update rh_colaborador set
      nome = p_data->>'nome', cpf = nullif(p_data->>'cpf',''), email = nullif(p_data->>'email',''),
      telefone = nullif(p_data->>'telefone',''), cargo = nullif(p_data->>'cargo',''),
      tipo_vinculo = nullif(p_data->>'tipo_vinculo',''),
      data_admissao = nullif(p_data->>'data_admissao','')::date,
      data_demissao = nullif(p_data->>'data_demissao','')::date,
      status = coalesce(nullif(p_data->>'status',''), status),
      gestor_id = nullif(p_data->>'gestor_id','')::uuid,
      membro_user_id = nullif(p_data->>'membro_user_id','')::uuid,
      salario_atual = nullif(p_data->>'salario_atual','')::numeric,
      beneficios_mensal = coalesce(nullif(p_data->>'beneficios_mensal','')::numeric, beneficios_mensal),
      custo_projetado_mensal = case when p_data ? 'custo_projetado_mensal'
                                    then nullif(p_data->>'custo_projetado_mensal','')::numeric
                                    else custo_projetado_mensal end,
      observacao = nullif(p_data->>'observacao',''), updated_at = now()
    where id = p_id and org_id = p_org_id
    returning id into v_id;
    if v_id is null then raise exception 'Colaborador não encontrado'; end if;
  end if;
  return v_id;
end; $$;

-- ── Hora vendável: média mensal em tarefas, normalizada pela cobertura ──────
-- Janela: últimos 90 dias, cortada no primeiro foco da org. horas/mês =
-- total ÷ dias cobertos × 30.44. Helper interno (revoke geral).
create or replace function horas_tarefas_mes(p_org uuid)
returns table (user_id uuid, horas_mes numeric)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_ini date; v_dias int;
begin
  select greatest(current_date - 90,
                  coalesce((select min((aberta_em at time zone 'America/Sao_Paulo')::date)
                            from activity_focus where org_id = p_org), current_date - 90))
    into v_ini;
  v_dias := greatest(1, current_date - v_ini);
  return query
  select s.user_id, round(sum(s.minutos) / 60.0 / v_dias * 30.44, 1)
  from horas_sessoes(p_org, v_ini, current_date) s
  group by s.user_id;
end $$;
revoke execute on function horas_tarefas_mes(uuid) from public, anon, authenticated;

-- ── Composição por pessoa (assinatura nova → drop antes) ────────────────────
drop function if exists horas_custo_camadas(uuid);

create function horas_custo_camadas(p_org uuid)
returns table (
  user_id uuid, nome text, comp date, clt boolean, fonte text, overhead boolean,
  bruto numeric, fgts numeric, encargos numeric, provisoes numeric, beneficios numeric,
  custo_mes numeric, horas_uteis numeric, horas_tarefas numeric, horas_base numeric,
  custo_direto_h numeric, overhead_h numeric, custo_hora numeric
)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_over numeric; v_comp date;
begin
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  select max(competencia) into v_comp from rh_folha where org_id = p_org;
  if v_comp is null then return; end if;
  select total_mes into v_over from horas_overhead_mes(p_org);

  return query
  with folha as (
    select c.id as colaborador_id, c.membro_user_id as uid, c.nome as cnome,
           c.beneficios_mensal as benef, c.custo_projetado_mensal as proj,
           coalesce(c.custo_overhead, false) as oh,
           bool_or(f.categoria like '101%') as eh_clt,
           sum(coalesce(f.vencimentos, 0)) as fbruto,
           sum(coalesce(f.fgts, 0)) as ffgts,
           sum(coalesce(f.inss, 0)) as retido,
           'folha'::text as origem
    from rh_folha f
    join rh_colaborador c on c.id = f.colaborador_id and c.membro_user_id is not null
    where f.org_id = p_org and f.competencia = v_comp
    group by c.id, c.membro_user_id, c.nome, c.beneficios_mensal, c.custo_projetado_mensal, c.custo_overhead
  ),
  ficha as (
    -- Ativo com login, fora da folha da competência: estagiário/terceiro fixo.
    select c.id, c.membro_user_id, c.nome, c.beneficios_mensal, c.custo_projetado_mensal,
           coalesce(c.custo_overhead, false),
           false, coalesce(c.salario_atual, 0), 0::numeric, 0::numeric, 'ficha'::text
    from rh_colaborador c
    where c.org_id = p_org and c.membro_user_id is not null
      and coalesce(c.arquivado, false) = false and c.status = 'ativo'
      and coalesce(c.salario_atual, 0) + coalesce(c.beneficios_mensal, 0) + coalesce(c.custo_projetado_mensal, 0) > 0
      and not exists (select 1 from rh_folha f
                      where f.org_id = p_org and f.competencia = v_comp and f.colaborador_id = c.id)
  ),
  pessoas as (
    select * from folha union all select * from ficha
  ),
  tarefas as (
    select t.user_id as tuid, t.horas_mes from horas_tarefas_mes(p_org) t
  ),
  uteis as (
    select fo.*,
           (( select count(*)
              from generate_series(v_comp::timestamp, (v_comp + interval '1 month - 1 day')::timestamp, interval '1 day') d
              where extract(isodow from d)::int = any (coalesce(
                  (select j.dias_semana from rh_jornada j where j.colaborador_id = fo.colaborador_id limit 1),
                  (select j.dias_semana from rh_jornada j where j.org_id = p_org and j.colaborador_id is null limit 1),
                  '{1,2,3,4,5}'::int[]))
                and not exists (select 1 from rh_feriado fe where fe.org_id = p_org and fe.data = d::date and fe.abona)
            ) * coalesce(
                  (select j.carga_min from rh_jornada j where j.colaborador_id = fo.colaborador_id limit 1),
                  (select j.carga_min from rh_jornada j where j.org_id = p_org and j.colaborador_id is null limit 1),
                  480)) / 60.0 as hu,
           coalesce(ta.horas_mes, 0) as ht
    from pessoas fo
    left join tarefas ta on ta.tuid = fo.uid
  ),
  tot as (
    -- Guia INSS: rateia só entre bruto de FOLHA não-projetado (o projetado já é custo total).
    select u.*,
           coalesce(nullif(sum(u.fbruto) filter (where u.origem = 'folha' and u.proj is null) over (), 0), 1) as bruto_total_folha,
           sum(u.retido) over () as retido_total
    from uteis u
  ),
  guia as (
    select t.*, greatest(0, coalesce((
      select sum(l.valor) from lancamentos l
      where l.org_id = p_org and l.origem_tipo = 'folha'
        and l.origem_ref = 'folha:' || v_comp || ':inss'
    ), 0) - t.retido_total) as custo_inss
    from tot t
  ),
  camadas as (
    select g.uid, g.cnome, g.eh_clt, g.oh,
           case when g.proj is not null then 'projetado' else g.origem end as cfonte,
           -- Camadas 1–3: o projetado substitui tudo (é o custo total da pessoa).
           case when g.proj is not null then g.proj else g.fbruto end as cbruto,
           case when g.proj is not null then 0 else g.ffgts end as cfgts,
           case when g.proj is not null or g.origem <> 'folha' then 0
                else round(g.custo_inss * g.fbruto / g.bruto_total_folha, 2) end as cencargos,
           case when g.proj is null and g.eh_clt then round(g.fbruto * 0.22, 2) else 0 end as cprovisoes,
           round(coalesce(g.benef, 0), 2) as cbenef,
           g.hu, g.ht,
           -- Denominador: hora vendável; sem medição vale a jornada útil.
           case when g.ht > 0 then g.ht else g.hu end as hbase
    from guia g
  ),
  pool as (
    -- Overhead total = estrutura + provisão de lucro + pessoas-overhead;
    -- denominador = horas-base de quem PRODUZ.
    select coalesce(v_over, 0)
         + coalesce(sum(c.cbruto + c.cfgts + c.cencargos + c.cprovisoes + c.cbenef) filter (where c.oh), 0) as total,
           coalesce(nullif(sum(c.hbase) filter (where not c.oh), 0), 1) as hbase_total
    from camadas c
  )
  select c.uid, c.cnome, v_comp, c.eh_clt, c.cfonte, c.oh,
         round(c.cbruto, 2), round(c.cfgts, 2), c.cencargos, c.cprovisoes, c.cbenef,
         round(c.cbruto + c.cfgts + c.cencargos + c.cprovisoes + c.cbenef, 2) as custo_mes,
         round(c.hu, 1), round(c.ht, 1), round(c.hbase, 1),
         case when not c.oh and c.hbase > 0
              then round((c.cbruto + c.cfgts + c.cencargos + c.cprovisoes + c.cbenef) / c.hbase, 2) end,
         case when not c.oh then round(p.total / p.hbase_total, 2) end,
         case when not c.oh and c.hbase > 0
              then round((c.cbruto + c.cfgts + c.cencargos + c.cprovisoes + c.cbenef) / c.hbase
                         + p.total / p.hbase_total, 2) end
  from camadas c, pool p
  order by c.cnome;
end $$;
revoke execute on function horas_custo_camadas(uuid) from public, anon;
grant  execute on function horas_custo_camadas(uuid) to authenticated;

-- ── horas_custo_hora (relatórios, por competência) ──────────────────────────
-- Mesmas três regras. Denominador do mês = horas em tarefa DAQUELE mês
-- (fallback jornada) — assim custo/h × horas atribuídas ≈ custo mensal real.
-- Pessoa-overhead devolve custo NULL: o custo dela já rateou nos outros;
-- multiplicar nas tarefas dela contaria em dobro.
create or replace function horas_custo_hora(p_org uuid)
returns table(user_id uuid, comp date, custo_hora numeric)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_over numeric; v_min date;
begin
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select total_mes into v_over from horas_overhead_mes(p_org);

  return query
  with jornada as (
    select c.id as colaborador_id,
           coalesce(
             (select j.carga_min from rh_jornada j where j.colaborador_id = c.id limit 1),
             (select j.carga_min from rh_jornada j where j.org_id = p_org and j.colaborador_id is null limit 1),
             480) as carga_min,
           coalesce(
             (select j.dias_semana from rh_jornada j where j.colaborador_id = c.id limit 1),
             (select j.dias_semana from rh_jornada j where j.org_id = p_org and j.colaborador_id is null limit 1),
             '{1,2,3,4,5}'::int[]) as dias_semana
    from rh_colaborador c where c.org_id = p_org
  ),
  comps as (
    select generate_series(
      least(
        coalesce((select min(date_trunc('month', f.competencia))::date from rh_folha f where f.org_id = p_org),
                 date_trunc('month', current_date)::date),
        coalesce((select min(date_trunc('month', af.aberta_em))::date from activity_focus af where af.org_id = p_org),
                 date_trunc('month', current_date)::date)
      ),
      date_trunc('month', current_date)::date,
      interval '1 month')::date as fcomp
  ),
  folha as (
    select c.id as colaborador_id, c.membro_user_id as u, c.beneficios_mensal,
           c.custo_projetado_mensal as proj, coalesce(c.custo_overhead, false) as oh,
           date_trunc('month', f.competencia)::date as fcomp,
           bool_or(f.categoria like '101%') as clt,
           sum(coalesce(f.vencimentos, 0)) as bruto,
           sum(coalesce(f.fgts, 0)) as fgts,
           sum(coalesce(f.inss, 0)) as inss_retido,
           'folha'::text as origem
    from rh_folha f
    join rh_colaborador c on c.id = f.colaborador_id and c.membro_user_id is not null
    where f.org_id = p_org
    group by c.id, c.membro_user_id, c.beneficios_mensal, c.custo_projetado_mensal, c.custo_overhead, 6
  ),
  ficha as (
    select c.id, c.membro_user_id, c.beneficios_mensal,
           c.custo_projetado_mensal, coalesce(c.custo_overhead, false),
           x.fcomp,
           (c.tipo_vinculo = 'clt') as clt,
           coalesce(c.salario_atual, 0) as bruto,
           case when c.tipo_vinculo = 'clt' then round(coalesce(c.salario_atual, 0) * 0.08, 2) else 0 end as fgts,
           0::numeric as inss_retido,
           'ficha'::text as origem
    from rh_colaborador c
    cross join comps x
    where c.org_id = p_org and c.membro_user_id is not null
      and coalesce(c.arquivado, false) = false and c.status = 'ativo'
      and coalesce(c.salario_atual, 0) + coalesce(c.beneficios_mensal, 0) + coalesce(c.custo_projetado_mensal, 0) > 0
      and (c.data_admissao is null or x.fcomp >= date_trunc('month', c.data_admissao)::date)
      and not exists (select 1 from rh_folha f
                      where f.org_id = p_org and f.colaborador_id = c.id
                        and date_trunc('month', f.competencia)::date = x.fcomp)
  ),
  pessoas as (
    select * from folha union all select * from ficha
  ),
  -- Horas em tarefa por pessoa/mês (uma chamada, agregada por mês).
  sess as (
    select s.user_id as su, date_trunc('month', s.dia)::date as sm, round(sum(s.minutos) / 60.0, 1) as ht
    from (select min(fcomp) as ini from comps) w,
         lateral horas_sessoes(p_org, w.ini, current_date) s
    group by s.user_id, 2
  ),
  uteis as (
    select fo.*, j.carga_min, j.dias_semana,
           (( select count(*)
              from generate_series(fo.fcomp::timestamp, (fo.fcomp + interval '1 month - 1 day')::timestamp, interval '1 day') d
              where extract(isodow from d)::int = any (j.dias_semana)
                and not exists (select 1 from rh_feriado fe where fe.org_id = p_org and fe.data = d::date and fe.abona)
            ) * j.carga_min) / 60.0 as hu,
           coalesce((select se.ht from sess se where se.su = fo.u and se.sm = fo.fcomp), 0) as ht
    from pessoas fo
    join jornada j on j.colaborador_id = fo.colaborador_id
  ),
  base as (
    select u.*,
           case when u.ht > 0 then u.ht else u.hu end as hbase,
           case when u.proj is not null then u.proj
                else u.bruto + u.fgts + case when u.clt then round(u.bruto * 0.22, 2) else 0 end end
             + coalesce(u.beneficios_mensal, 0) as custo_mes_sem_guia
    from uteis u
  ),
  tot as (
    select fcomp,
           coalesce(nullif(sum(hbase) filter (where not oh), 0), 1) as hbase_total,
           coalesce(nullif(sum(bruto) filter (where origem = 'folha' and proj is null), 0), 1) as bruto_total_folha,
           sum(inss_retido) as retido_total,
           coalesce(sum(custo_mes_sem_guia) filter (where oh), 0) as pool_pessoas
    from base group by 1
  ),
  guia as (
    select t.fcomp,
           greatest(0, coalesce((
             select sum(l.valor) from lancamentos l
             where l.org_id = p_org and l.origem_tipo = 'folha'
               and l.origem_ref = 'folha:' || t.fcomp || ':inss'
           ), 0) - t.retido_total) as custo_inss
    from tot t
  )
  select b.u, b.fcomp,
         case when not b.oh and b.hbase > 0 then
           round((b.custo_mes_sem_guia
              + case when b.origem = 'folha' and b.proj is null
                     then g.custo_inss * b.bruto / t.bruto_total_folha else 0 end) / b.hbase
              + (coalesce(v_over, 0) + t.pool_pessoas) / t.hbase_total, 2) end
  from base b
  join tot t on t.fcomp = b.fcomp
  join guia g on g.fcomp = b.fcomp;
end $$;
revoke execute on function horas_custo_hora(uuid) from public, anon;
grant  execute on function horas_custo_hora(uuid) to authenticated;

-- ── Preço de venda: pondera pelas horas-base (vendáveis) ────────────────────
create or replace function horas_preco_venda(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_custo_medio numeric; v_horas numeric; v_imposto numeric; v_imposto_auto numeric;
  v_das numeric; v_recebido numeric; v_margem numeric; v_manual numeric;
  v_over record; v_comp date; v_pool_pessoas numeric;
begin
  if not horas_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  select max(competencia) into v_comp from rh_folha where org_id = p_org;

  -- custo médio ponderado pelas horas-base de quem produz + pool de pessoas-overhead
  select sum(c.custo_hora * c.horas_base) filter (where not c.overhead),
         sum(c.horas_base) filter (where not c.overhead),
         coalesce(sum(c.custo_mes) filter (where c.overhead), 0)
    into v_custo_medio, v_horas, v_pool_pessoas
  from horas_custo_camadas(p_org) c where c.custo_hora is not null or c.overhead;
  if coalesce(v_horas, 0) > 0 then v_custo_medio := round(v_custo_medio / v_horas, 2); end if;

  select custo_imposto_pct, custo_margem_alvo_pct into v_manual, v_margem
  from org_settings where org_id = p_org;
  v_margem := coalesce(v_margem, 20);

  select coalesce(sum(coalesce(valor_realizado, valor)), 0) into v_das
  from lancamentos
  where org_id = p_org and tipo = 'saida' and situacao = 'pago'
    and categoria ilike '%simples%'
    and data_liquidacao > current_date - interval '12 months';
  select coalesce(sum(coalesce(valor_realizado, valor)), 0) into v_recebido
  from lancamentos
  where org_id = p_org and tipo = 'entrada' and situacao = 'recebido'
    and data_liquidacao > current_date - interval '12 months';
  v_imposto_auto := case when v_recebido > 0 then round(v_das / v_recebido * 100, 2) end;
  v_imposto := coalesce(v_manual, v_imposto_auto, 12.5);

  select * into v_over from horas_overhead_mes(p_org);

  return jsonb_build_object(
    'comp', v_comp,
    'custo_hora_medio', v_custo_medio,
    'horas_uteis_mes', round(coalesce(v_horas, 0), 0),
    'overhead_estrutura_mes', v_over.estrutura_mes,
    'provisao_lucro_mes', v_over.provisao_lucro,
    'overhead_pessoas_mes', round(v_pool_pessoas, 2),
    'imposto_pct', v_imposto,
    'imposto_auto_pct', v_imposto_auto,
    'imposto_manual', v_manual is not null,
    'das_12m', round(v_das, 2),
    'recebido_12m', round(v_recebido, 2),
    'margem_pct', v_margem,
    'preco_hora', case when v_custo_medio is not null and (1 - v_imposto/100 - v_margem/100) > 0
                       then round(v_custo_medio / (1 - v_imposto/100 - v_margem/100), 2) end
  );
end $$;
revoke execute on function horas_preco_venda(uuid) from public, anon;
grant execute on function horas_preco_venda(uuid) to authenticated;

notify pgrst, 'reload schema';
