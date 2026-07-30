-- 162_rh_calendario_fechamento.sql
-- Fase 3 (cont.): calendário de feriados/emendas + fechamento do mês para a contabilidade.
--
-- Por que o calendário: feriado/emenda NÃO pode virar falta ("não descontar essas horas").
-- Hoje rh_bater_ponto compara o trabalhado com carga_min sempre — num feriado isso gera
-- saldo negativo falso. Aqui o dia marcado passa a ter carga esperada ZERO, e o que for
-- trabalhado nele conta como hora extra (100% em feriado, por padrão).
--
-- Fechamento: período configurável (One a One usa 26→25; outras empresas mês cheio).
-- O relatório é o que vai para a contabilidade — matrícula = CPF.
-- Colunas: H.N. · H.E.50 · H.E.100 · Faltas · H.Totais · Quitação Banco.
--   Faltas   = Σ max(0, carga_do_dia − trabalhado)  (inclui atraso parcial)
--   H.E.     = Σ max(0, trabalhado − carga_do_dia), só o APROVADO pelo gestor
--   Quitação = H.E.50 + H.E.100 − Faltas            (confirmado com o relatório atual)
--   H.Totais = H.N. + H.E.50 + H.E.100 − Faltas     (positivas menos negativas)
-- Idempotente.

-- ── Calendário: feriado / emenda / ponto facultativo ──
create table if not exists rh_feriado (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  data       date not null,
  nome       text,
  tipo       text not null default 'feriado',   -- feriado | emenda | facultativo
  abona      boolean not null default true,     -- não espera horas (não vira falta)
  extra_100  boolean not null default true,     -- trabalho nesse dia = HE 100%
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists rh_feriado_uk on rh_feriado (org_id, data);

alter table rh_feriado enable row level security;
drop policy if exists rh_feriado_rw on rh_feriado;
-- RH gerencia; qualquer membro autenticado da org LÊ (o /ponto precisa saber que é feriado).
create policy rh_feriado_rw on rh_feriado for all
  using (rh_can(org_id) or exists (select 1 from organization_members m where m.org_id = rh_feriado.org_id and m.user_id = auth.uid()))
  with check (rh_can(org_id));

-- ── Config do fechamento (período + pagamento) ──
create table if not exists rh_fechamento_config (
  org_id        uuid primary key references organizations(id) on delete cascade,
  dia_ini       int  not null default 26,     -- 1 = mês cheio; senão fecha do dia X ao (X-1) do mês seguinte
  dia_pagamento int  not null default 30,
  paga_mes_seguinte boolean not null default false,
  updated_at    timestamptz not null default now(),
  constraint rh_fech_dia_ini_ck check (dia_ini between 1 and 28)   -- >28 quebraria em fevereiro
);
alter table rh_fechamento_config enable row level security;
drop policy if exists rh_fechamento_config_rw on rh_fechamento_config;
create policy rh_fechamento_config_rw on rh_fechamento_config for all using (rh_can(org_id)) with check (rh_can(org_id));

-- ── Período do fechamento de uma competência ──
-- dia_ini = 1  → mês cheio (01..último dia)
-- dia_ini = 26 → 26 do mês anterior .. 25 da competência
create or replace function rh_periodo_fechamento(p_org_id uuid, p_competencia date)
returns table (ini date, fim date) language sql stable security definer set search_path to 'public' as $$
  with cfg as (
    select coalesce((select dia_ini from rh_fechamento_config where org_id = p_org_id), 26) as dia_ini
  )
  select
    case when cfg.dia_ini = 1 then date_trunc('month', p_competencia)::date
         else (date_trunc('month', p_competencia) - interval '1 month')::date + (cfg.dia_ini - 1) end,
    case when cfg.dia_ini = 1 then (date_trunc('month', p_competencia) + interval '1 month' - interval '1 day')::date
         else p_competencia + (cfg.dia_ini - 2) end
  from cfg;
$$;
revoke execute on function rh_periodo_fechamento(uuid, date) from public;
grant execute on function rh_periodo_fechamento(uuid, date) to authenticated;

-- ── Salvar feriado / config ──
create or replace function rh_upsert_feriado(p_org_id uuid, p_data date, p_nome text, p_tipo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_tipo text; v_100 boolean;
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  v_tipo := coalesce(nullif(p_tipo, ''), 'feriado');
  -- Emenda/facultativo não são feriado legal → hora extra nele é 50%, não 100%.
  v_100 := (v_tipo = 'feriado');
  insert into rh_feriado (org_id, data, nome, tipo, abona, extra_100, created_by)
  values (p_org_id, p_data, nullif(p_nome, ''), v_tipo, true, v_100, auth.uid())
  on conflict (org_id, data) do update
    set nome = excluded.nome, tipo = excluded.tipo, extra_100 = excluded.extra_100
  returning id into v_id;
  return v_id;
end; $$;
revoke execute on function rh_upsert_feriado(uuid, date, text, text) from public;
grant execute on function rh_upsert_feriado(uuid, date, text, text) to authenticated;

create or replace function rh_delete_feriado(p_org_id uuid, p_data date)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  delete from rh_feriado where org_id = p_org_id and data = p_data;
end; $$;
revoke execute on function rh_delete_feriado(uuid, date) from public;
grant execute on function rh_delete_feriado(uuid, date) to authenticated;

create or replace function rh_salvar_fechamento_config(p_org_id uuid, p_dia_ini int, p_dia_pagamento int, p_paga_mes_seguinte boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_dia_ini is null or p_dia_ini < 1 or p_dia_ini > 28 then
    raise exception 'Dia de início deve ficar entre 1 e 28 (acima disso quebra em fevereiro)';
  end if;
  insert into rh_fechamento_config (org_id, dia_ini, dia_pagamento, paga_mes_seguinte, updated_at)
  values (p_org_id, p_dia_ini, coalesce(p_dia_pagamento, 30), coalesce(p_paga_mes_seguinte, false), now())
  on conflict (org_id) do update set
    dia_ini = excluded.dia_ini, dia_pagamento = excluded.dia_pagamento,
    paga_mes_seguinte = excluded.paga_mes_seguinte, updated_at = now();
end; $$;
revoke execute on function rh_salvar_fechamento_config(uuid, int, int, boolean) from public;
grant execute on function rh_salvar_fechamento_config(uuid, int, int, boolean) to authenticated;

-- ── Relatório de fechamento (o report da contabilidade) ──
create or replace function rh_fechamento(p_org_id uuid, p_competencia date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_ini date; v_fim date; v_linhas jsonb := '[]'::jsonb;
  c record; j rh_jornada; d date;
  v_hn int; v_h50 int; v_h100 int; v_falta int; v_pend int; v_edit timestamptz;
  v_carga int; v_trab int; v_esp boolean; v_ab boolean; v_100 boolean; v_extra int;
  v_status text; v_upd timestamptz; v_dias int; v_esperados int;
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select ini, fim into v_ini, v_fim from rh_periodo_fechamento(p_org_id, p_competencia);

  for c in
    select co.id, co.nome, co.cpf, co.cargo
    from rh_colaborador co
    where co.org_id = p_org_id and not co.arquivado
      and (co.status <> 'desligado'
           or exists (select 1 from rh_ponto p where p.colaborador_id = co.id and p.data between v_ini and v_fim))
    order by co.nome
  loop
    j := rh_jornada_de(c.id);
    v_hn := 0; v_h50 := 0; v_h100 := 0; v_falta := 0; v_pend := 0; v_edit := null;
    v_dias := 0; v_esperados := 0;

    d := v_ini;
    while d <= v_fim loop
      v_carga := coalesce(j.carga_min, 480);
      -- Dia esperado = está nos dias_semana da jornada E não é feriado/emenda que abona.
      v_esp := (extract(isodow from d)::int = any (coalesce(j.dias_semana, array[1,2,3,4,5])));
      select f.abona, f.extra_100 into v_ab, v_100 from rh_feriado f where f.org_id = p_org_id and f.data = d;
      if found and coalesce(v_ab, true) then v_esp := false; end if;
      if not found then v_100 := false; end if;

      select p.minutos, p.extra_status, p.updated_at into v_trab, v_status, v_upd
      from rh_ponto p where p.colaborador_id = c.id and p.data = d;
      if not found then v_trab := 0; v_status := null; v_upd := null; else v_dias := v_dias + 1; end if;
      v_trab := coalesce(v_trab, 0);
      if v_upd is not null and (v_edit is null or v_upd > v_edit) then v_edit := v_upd; end if;

      if v_esp then
        v_esperados := v_esperados + 1;
        v_hn := v_hn + least(v_trab, v_carga);
        v_extra := greatest(0, v_trab - v_carga);
        if v_extra > 0 then
          -- Só entra na folha o que o gestor aprovou; o resto fica sinalizado.
          if v_status = 'aprovado' then
            if v_100 then v_h100 := v_h100 + v_extra; else v_h50 := v_h50 + v_extra; end if;
          else v_pend := v_pend + v_extra; end if;
        elsif v_trab < v_carga then
          -- Justificativa aprovada/abonada credita o dia (não vira falta).
          if exists (select 1 from rh_justificativa x
                     where x.colaborador_id = c.id and x.status in ('aprovado','abonado')
                       and d between x.data_ini and x.data_fim) then
            v_hn := v_hn + (v_carga - v_trab);
          else
            v_falta := v_falta + (v_carga - v_trab);
          end if;
        end if;
      elsif v_trab > 0 then
        -- Dia não esperado (fim de semana, feriado, emenda): tudo é extra.
        if v_status = 'aprovado' then
          if v_100 then v_h100 := v_h100 + v_trab; else v_h50 := v_h50 + v_trab; end if;
        else v_pend := v_pend + v_trab; end if;
      end if;

      d := d + 1;
    end loop;

    v_linhas := v_linhas || jsonb_build_object(
      'colaborador_id', c.id, 'nome', c.nome, 'cpf', c.cpf, 'cargo', c.cargo,
      'hn_min', v_hn, 'he50_min', v_h50, 'he100_min', v_h100, 'faltas_min', v_falta,
      'total_min', v_hn + v_h50 + v_h100 - v_falta,
      'quitacao_min', v_h50 + v_h100 - v_falta,
      'pendente_min', v_pend, 'editado_em', v_edit,
      -- dias_com_ponto = 0 → a pessoa não bateu ponto no período (dado ausente),
      -- diferente de ter faltado: a tela mostra "sem marcação" em vez de 168h de falta.
      'dias_com_ponto', v_dias, 'dias_esperados', v_esperados);
  end loop;

  return jsonb_build_object('ini', v_ini, 'fim', v_fim,
    'competencia', to_char(p_competencia, 'YYYY-MM'), 'linhas', v_linhas);
end; $$;
revoke execute on function rh_fechamento(uuid, date) from public;
grant execute on function rh_fechamento(uuid, date) to authenticated;

-- ── rh_bater_ponto: feriado/emenda passa a ter carga esperada ZERO ──
-- (senão o dia marcado gera saldo negativo falso para quem não trabalha nele)
create or replace function rh_bater_ponto(p_colaborador_id uuid, p_tipo text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_org uuid; v_hoje date; v_agora time; j rh_jornada; p rh_ponto; v_min int; v_manha int; v_tarde int;
  v_carga int; v_abona boolean;
begin
  select org_id into v_org from rh_colaborador where id = p_colaborador_id;
  if v_org is null then raise exception 'Colaborador não encontrado'; end if;
  if not (rh_is_self(p_colaborador_id) or rh_can(v_org)) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  v_hoje  := (now() at time zone 'America/Sao_Paulo')::date;
  v_agora := (now() at time zone 'America/Sao_Paulo')::time;
  j := rh_jornada_de(p_colaborador_id);

  insert into rh_ponto (org_id, colaborador_id, data) values (v_org, p_colaborador_id, v_hoje)
    on conflict (colaborador_id, data) do nothing;
  select * into p from rh_ponto where colaborador_id = p_colaborador_id and data = v_hoje;

  if p_tipo = 'entrada' then
    if p.entrada is not null then raise exception 'Entrada já registrada hoje'; end if;
    update rh_ponto set entrada = v_agora, updated_at = now() where id = p.id;
  elsif p_tipo = 'intervalo_ini' then
    if p.entrada is null then raise exception 'Bata a entrada primeiro'; end if;
    if p.intervalo_ini is not null then raise exception 'Intervalo já iniciado'; end if;
    update rh_ponto set intervalo_ini = v_agora, updated_at = now() where id = p.id;
  elsif p_tipo = 'intervalo_fim' then
    if p.intervalo_ini is null then raise exception 'Inicie o intervalo primeiro'; end if;
    if p.intervalo_fim is not null then raise exception 'Retorno já registrado'; end if;
    if extract(epoch from (v_agora - p.intervalo_ini)) / 60 < coalesce(j.intervalo_min, 60) then
      raise exception 'Intervalo mínimo de % min. Aguarde para registrar o retorno.', coalesce(j.intervalo_min, 60);
    end if;
    update rh_ponto set intervalo_fim = v_agora, updated_at = now() where id = p.id;
  elsif p_tipo = 'saida' then
    if p.entrada is null then raise exception 'Bata a entrada primeiro'; end if;
    if p.saida is not null then raise exception 'Saída já registrada'; end if;
    update rh_ponto set saida = v_agora, updated_at = now() where id = p.id;
  else
    raise exception 'Tipo de marcação inválido';
  end if;

  select * into p from rh_ponto where id = p.id;
  if p.saida is not null and p.entrada is not null then
    v_manha := case when p.intervalo_ini is not null
                    then (extract(epoch from (p.intervalo_ini - p.entrada)) / 60)::int
                    else (extract(epoch from (p.saida - p.entrada)) / 60)::int end;
    v_tarde := case when p.intervalo_fim is not null and p.saida is not null
                    then (extract(epoch from (p.saida - p.intervalo_fim)) / 60)::int else 0 end;
    v_min := greatest(0, coalesce(v_manha,0) + coalesce(v_tarde,0));

    -- Carga esperada do dia: 0 em feriado/emenda que abona, ou fora dos dias de jornada.
    v_carga := coalesce(j.carga_min, 480);
    select abona into v_abona from rh_feriado where org_id = v_org and data = p.data;
    if (found and coalesce(v_abona, true))
       or not (extract(isodow from p.data)::int = any (coalesce(j.dias_semana, array[1,2,3,4,5])))
    then v_carga := 0; end if;

    update rh_ponto set
      minutos = least(v_min, coalesce(j.max_dia_min, 600)),
      acima_10h = (v_min > coalesce(j.max_dia_min, 600)),
      saldo_min = least(v_min, coalesce(j.max_dia_min, 600)) - v_carga,
      extra_status = case when least(v_min, coalesce(j.max_dia_min,600)) - v_carga > 0
                          then coalesce(extra_status, 'pendente') else extra_status end,
      updated_at = now()
    where id = p.id;
  end if;

  select * into p from rh_ponto where id = p.id;
  return jsonb_build_object('tipo', p_tipo, 'hora', v_agora, 'minutos', p.minutos, 'saldo_min', p.saldo_min, 'acima_10h', p.acima_10h);
end; $$;
revoke execute on function rh_bater_ponto(uuid,text) from public;
grant execute on function rh_bater_ponto(uuid,text) to authenticated;

notify pgrst, 'reload schema';
