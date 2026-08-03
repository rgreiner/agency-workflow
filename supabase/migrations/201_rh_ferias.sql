-- 201_rh_ferias.sql
-- Auditoria 02/08, RH (alta): "Férias e 13º não têm gestão nenhuma — só existem
-- como percentual de provisão". Não havia tabela de férias no schema: "férias"
-- aparecia como tipo de documento, como os 22% de provisão no custo/hora e como
-- categoria financeira — nunca como período com data.
--
-- Escolha do Rafael (03/08): começar PELA GESTÃO (períodos e alertas), não pelo
-- caixa. O passivo no Fluxo de caixa fica para depois.
--
-- Decisão de modelagem: os períodos aquisitivos NÃO são gravados, são
-- calculados a partir de `data_admissao`. Período aquisitivo é consequência
-- aritmética da admissão — guardar seria criar uma segunda verdade que
-- silenciosamente diverge quando alguém corrige a data de admissão. O que se
-- grava é só o que é decisão humana: as férias programadas ou gozadas.
--
-- Regras implementadas (CLT):
--   · aquisitivo = 12 meses a partir da admissão, e a cada 12 meses depois
--   · concessivo = os 12 meses SEGUINTES ao fim do aquisitivo (art. 134); passar
--     dele é férias em dobro (art. 137), por isso o alerta existe
--   · aviso ao empregado com 30 dias de antecedência (art. 135)
--   · fracionamento em até 3 períodos, um ≥14 dias e nenhum <5 (art. 134 §1º)
--
-- Deliberadamente FORA: redução de dias por faltas injustificadas (art. 130) —
-- depende de fechamento de ponto por período aquisitivo e o Rafael não pediu; o
-- direito nasce 30 e o RH ajusta na mão se precisar. Estagiário tem recesso da
-- Lei 11.788, que é outro regime: só CLT entra aqui.
--
-- Idempotente.

create table if not exists rh_ferias (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  colaborador_id  uuid not null references rh_colaborador(id) on delete cascade,
  -- Início do período AQUISITIVO a que estas férias pertencem. É a chave que
  -- liga o gozo ao direito; sem ela não dá para dizer qual período foi quitado.
  periodo_inicio  date not null,
  inicio          date not null,
  fim             date not null,
  dias            int  not null,
  abono_dias      int  not null default 0,   -- abono pecuniário (art. 143)
  status          text not null default 'programada',  -- programada | gozada | cancelada
  observacao      text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  constraint rh_ferias_dias_ck   check (dias between 1 and 30),
  constraint rh_ferias_abono_ck  check (abono_dias between 0 and 10),
  constraint rh_ferias_status_ck check (status in ('programada','gozada','cancelada')),
  constraint rh_ferias_datas_ck  check (fim >= inicio)
);
create index if not exists rh_ferias_colab_idx on rh_ferias (colaborador_id, periodo_inicio);
alter table rh_ferias enable row level security;
drop policy if exists rh_ferias_ler on rh_ferias;
drop policy if exists rh_ferias_rh  on rh_ferias;
-- A pessoa vê as próprias férias; mexer é do RH (mesma régua do ponto, mig. 194).
create policy rh_ferias_ler on rh_ferias for select
  using (rh_can(org_id) or rh_is_self(colaborador_id));
create policy rh_ferias_rh on rh_ferias for all
  using (rh_can(org_id)) with check (rh_can(org_id));

-- ── Períodos aquisitivos de uma pessoa ──────────────────────────────────────
-- Devolve um período por ciclo de 12 meses desde a admissão, incluindo o que
-- ainda está em formação (o atual), com direito, gozado e saldo.
create or replace function rh_ferias_periodos(p_org uuid)
returns table (
  colaborador_id uuid, pessoa text, data_admissao date,
  periodo_inicio date, periodo_fim date, limite date,
  dias_direito int, dias_gozados int, dias_programados int, dias_saldo int,
  em_formacao boolean, dias_para_limite int, situacao text
) language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  return query
  with pessoas as (
    select c.id, c.nome, c.data_admissao
      from rh_colaborador c
     where c.org_id = p_org and c.tipo_vinculo = 'clt'
       and c.status = 'ativo' and coalesce(c.arquivado, false) = false
       and c.data_admissao is not null
  ),
  ciclos as (
    select p.id, p.nome, p.data_admissao,
           (p.data_admissao + (n * interval '1 year'))::date as p_ini
      from pessoas p
      -- Um ciclo por ano completo desde a admissão, mais o que está em formação.
      cross join generate_series(0,
        greatest(0, floor(extract(epoch from age(current_date, p.data_admissao)) / (365.2425 * 86400))::int)) n
  ),
  base as (
    select c.id as colaborador_id, c.nome as pessoa, c.data_admissao,
           c.p_ini as periodo_inicio,
           (c.p_ini + interval '1 year' - interval '1 day')::date as periodo_fim,
           (c.p_ini + interval '2 years' - interval '1 day')::date as limite
      from ciclos c
  )
  select b.colaborador_id, b.pessoa, b.data_admissao,
         b.periodo_inicio, b.periodo_fim, b.limite,
         30 as dias_direito,
         coalesce((select sum(f.dias + f.abono_dias) from rh_ferias f
                    where f.colaborador_id = b.colaborador_id and f.periodo_inicio = b.periodo_inicio
                      and f.status = 'gozada'), 0)::int as dias_gozados,
         coalesce((select sum(f.dias + f.abono_dias) from rh_ferias f
                    where f.colaborador_id = b.colaborador_id and f.periodo_inicio = b.periodo_inicio
                      and f.status = 'programada'), 0)::int as dias_programados,
         (30 - coalesce((select sum(f.dias + f.abono_dias) from rh_ferias f
                    where f.colaborador_id = b.colaborador_id and f.periodo_inicio = b.periodo_inicio
                      and f.status in ('gozada','programada')), 0))::int as dias_saldo,
         (b.periodo_fim > current_date) as em_formacao,
         (b.limite - current_date)::int as dias_para_limite,
         case
           when b.periodo_fim > current_date then 'em_formacao'
           when (30 - coalesce((select sum(f.dias + f.abono_dias) from rh_ferias f
                    where f.colaborador_id = b.colaborador_id and f.periodo_inicio = b.periodo_inicio
                      and f.status in ('gozada','programada')), 0)) <= 0 then 'quitado'
           -- Passou do concessivo: a partir daqui é férias em dobro (art. 137).
           when b.limite < current_date then 'vencido'
           when (b.limite - current_date) <= 90 then 'vence_em_breve'
           else 'aberto'
         end as situacao
    from base b
   order by b.pessoa, b.periodo_inicio;
end $$;

-- ── Programar / registrar férias ────────────────────────────────────────────
create or replace function rh_ferias_programar(p_dados jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_colab uuid; v_org uuid; v_ini date; v_fim date; v_dias int; v_abono int;
  v_periodo date; v_status text; v_saldo int; v_n int; v_menor int;
begin
  v_colab   := nullif(p_dados->>'colaborador_id','')::uuid;
  v_ini     := nullif(p_dados->>'inicio','')::date;
  v_fim     := nullif(p_dados->>'fim','')::date;
  v_periodo := nullif(p_dados->>'periodo_inicio','')::date;
  v_abono   := coalesce(nullif(p_dados->>'abono_dias','')::int, 0);
  v_status  := coalesce(nullif(p_dados->>'status',''), 'programada');

  select org_id into v_org from rh_colaborador where id = v_colab;
  if v_org is null then raise exception 'Pessoa não encontrada'; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if v_ini is null or v_fim is null or v_periodo is null then
    raise exception 'Informe o período aquisitivo e as datas de início e fim';
  end if;
  if v_fim < v_ini then raise exception 'O fim não pode ser antes do início'; end if;

  v_dias := (v_fim - v_ini) + 1;   -- dias CORRIDOS (art. 130)

  -- Saldo do período aquisitivo.
  select 30 - coalesce(sum(f.dias + f.abono_dias), 0) into v_saldo
    from rh_ferias f
   where f.colaborador_id = v_colab and f.periodo_inicio = v_periodo
     and f.status in ('gozada','programada');
  if v_dias + v_abono > v_saldo then
    raise exception 'Só restam % dia(s) neste período aquisitivo (pedido: % + % de abono)',
      v_saldo, v_dias, v_abono;
  end if;

  -- Fracionamento (art. 134 §1º): no máximo 3 pedaços, um deles com 14+ dias e
  -- nenhum com menos de 5. Só vale a pena conferir quando o período é fracionado.
  select count(*) + 1, least(coalesce(min(f.dias), 99), v_dias)
    into v_n, v_menor
    from rh_ferias f
   where f.colaborador_id = v_colab and f.periodo_inicio = v_periodo
     and f.status in ('gozada','programada');
  if v_n > 3 then raise exception 'Férias podem ser divididas em no máximo 3 períodos (art. 134 §1º)'; end if;
  if v_n > 1 and v_dias < 5 then raise exception 'Nenhum período fracionado pode ter menos de 5 dias corridos'; end if;
  if v_n > 1 and v_dias + v_saldo - v_dias - v_abono < 14 and v_dias < 14
     and not exists (select 1 from rh_ferias f
                      where f.colaborador_id = v_colab and f.periodo_inicio = v_periodo
                        and f.status in ('gozada','programada') and f.dias >= 14) then
    raise exception 'Um dos períodos precisa ter 14 dias ou mais (art. 134 §1º)';
  end if;

  insert into rh_ferias (org_id, colaborador_id, periodo_inicio, inicio, fim, dias, abono_dias,
                         status, observacao, created_by)
  values (v_org, v_colab, v_periodo, v_ini, v_fim, v_dias, v_abono,
          case when v_status in ('programada','gozada') then v_status else 'programada' end,
          nullif(btrim(coalesce(p_dados->>'observacao','')), ''), auth.uid());

  return jsonb_build_object('ok', true, 'dias', v_dias, 'saldo_restante', v_saldo - v_dias - v_abono);
end $$;

create or replace function rh_ferias_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid;
begin
  select org_id into v_org from rh_ferias where id = p_id;
  if v_org is null then raise exception 'Registro não encontrado'; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_status not in ('programada','gozada','cancelada') then raise exception 'Status inválido'; end if;
  update rh_ferias set status = p_status where id = p_id;
end $$;

-- ── 13º salário ────────────────────────────────────────────────────────────
-- Proporcional aos meses do ano com 15+ dias trabalhados (art. 1º da Lei
-- 4.090/62). As duas parcelas: até 30/11 e até 20/12.
create or replace function rh_decimo_terceiro(p_org uuid, p_ano int default null)
returns table (
  colaborador_id uuid, pessoa text, data_admissao date,
  meses int, base numeric, total numeric, parcela1 numeric, parcela2 numeric,
  venc1 date, venc2 date
) language plpgsql stable security definer set search_path to 'public' as $$
declare v_ano int;
begin
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  v_ano := coalesce(p_ano, extract(year from current_date)::int);

  return query
  with pessoas as (
    select c.id, c.nome, c.data_admissao, coalesce(c.salario_atual, 0) as salario
      from rh_colaborador c
     where c.org_id = p_org and c.tipo_vinculo = 'clt'
       and c.status = 'ativo' and coalesce(c.arquivado, false) = false
  ),
  meses_calc as (
    select p.*,
      (select count(*) from generate_series(
          greatest(date_trunc('month', coalesce(p.data_admissao, make_date(v_ano,1,1)))::date,
                   make_date(v_ano, 1, 1)),
          make_date(v_ano, 12, 1), interval '1 month') m
        where
          -- Mês do ano com 15+ dias de vínculo conta inteiro.
          case when date_trunc('month', p.data_admissao) = m::date
               then (date_part('day', (m + interval '1 month - 1 day')) - date_part('day', p.data_admissao) + 1) >= 15
               else true end
      )::int as meses_trab
      from pessoas p
  )
  select mc.id, mc.nome, mc.data_admissao,
         least(mc.meses_trab, 12)::int,
         mc.salario,
         round(mc.salario * least(mc.meses_trab, 12) / 12.0, 2),
         round(mc.salario * least(mc.meses_trab, 12) / 12.0 / 2, 2),
         round(mc.salario * least(mc.meses_trab, 12) / 12.0, 2)
           - round(mc.salario * least(mc.meses_trab, 12) / 12.0 / 2, 2),
         make_date(v_ano, 11, 30), make_date(v_ano, 12, 20)
    from meses_calc mc
   where mc.salario > 0
   order by mc.nome;
end $$;

revoke execute on function rh_ferias_periodos(uuid)          from public, anon;
revoke execute on function rh_ferias_programar(jsonb)        from public, anon;
revoke execute on function rh_ferias_status(uuid, text)      from public, anon;
revoke execute on function rh_decimo_terceiro(uuid, int)     from public, anon;
grant  execute on function rh_ferias_periodos(uuid)          to authenticated;
grant  execute on function rh_ferias_programar(jsonb)        to authenticated;
grant  execute on function rh_ferias_status(uuid, text)      to authenticated;
grant  execute on function rh_decimo_terceiro(uuid, int)     to authenticated;
grant  select on rh_ferias                                   to authenticated;

notify pgrst, 'reload schema';
