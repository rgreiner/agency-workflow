-- 170_custo_hora_cheio.sql
-- Custo da hora COMPLETO (composição em camadas) + preço de venda da hora.
--
-- Contexto fiscal informado pelo Rafael (31/07/2026): Simples Nacional em REGIME
-- DE CAIXA, alíquota efetiva histórica 11–14% sobre o recebido. Consequências no
-- modelo:
--   • A CPP patronal vive DENTRO do DAS → não existe "INSS patronal" separado
--     sobre a folha. O custo-empresa da guia INSS = guia paga − retido dos
--     empregados (no Simples ≈ 0, e o cálculo captura isso sozinho).
--   • O imposto entra como % sobre a RECEITA RECEBIDA — calculável do próprio
--     caixa: DAS pago ÷ recebido (12 meses, regime de caixa = data_liquidacao).
--   • A distribuição de lucro projetada do sócio (que não vira pró-labore) é
--     PROVISIONADA COMO OVERHEAD, rateada nas horas produtivas do time — pedido
--     explícito: "precisamos me provisionar como overhead na gestão das demandas".
--
-- Camadas do custo (por pessoa, por competência da folha):
--   1. direto      = bruto (vencimentos) + FGTS               ← rh_folha
--   2. encargos    = (guia INSS paga − INSS retido) rateado por bruto ← lançamento 'folha:*:inss'
--   3. provisões   = 21% × bruto, só CLT (13º 8,33% + férias+⅓ 11,11% + FGTS s/ ambos)
--   4. benefícios  = custo-empresa mensal na ficha (rh_colaborador.beneficios_mensal)
--   5. overhead/h  = (estrutura média 3 meses [macros Administrativo+Financeiro]
--                     + provisão de lucro mensal) ÷ horas úteis do time
--
--   custo_hora_cheio = (1+2+3+4) ÷ horas úteis da pessoa + overhead/h
--   preço de venda   = custo médio ponderado ÷ (1 − imposto efetivo − margem alvo)
--
-- `horas_custo_hora` (usada pelos relatórios de Horas) passa a devolver o CHEIO —
-- as telas existentes ganham o número certo sem mudar código.

-- ── Config da org (org_settings SÓ escreve por RPC — ver migration 130) ──────
alter table org_settings add column if not exists custo_provisao_lucro   numeric not null default 0;
alter table org_settings add column if not exists custo_margem_alvo_pct  numeric not null default 20;
alter table org_settings add column if not exists custo_imposto_pct      numeric;  -- null = automático (DAS÷recebido)

create or replace function set_custo_config(p_org uuid, p_data jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org and user_id = auth.uid() and role in ('owner','admin')
  ) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  update org_settings set
    custo_provisao_lucro  = coalesce((p_data->>'provisao_lucro')::numeric, custo_provisao_lucro),
    custo_margem_alvo_pct = coalesce((p_data->>'margem_alvo_pct')::numeric, custo_margem_alvo_pct),
    -- imposto: string vazia = voltar pro automático (null); número = manual
    custo_imposto_pct     = case when p_data ? 'imposto_pct'
                                 then nullif(p_data->>'imposto_pct','')::numeric
                                 else custo_imposto_pct end,
    updated_at = now()
  where org_id = p_org;
  if not found then
    insert into org_settings (org_id, custo_provisao_lucro, custo_margem_alvo_pct, custo_imposto_pct)
    values (p_org, coalesce((p_data->>'provisao_lucro')::numeric, 0),
            coalesce((p_data->>'margem_alvo_pct')::numeric, 20),
            nullif(p_data->>'imposto_pct','')::numeric);
  end if;
end $$;
revoke execute on function set_custo_config(uuid, jsonb) from anon, authenticated, public;
grant execute on function set_custo_config(uuid, jsonb) to authenticated;

-- ── Benefícios a custo-empresa na ficha ──────────────────────────────────────
alter table rh_colaborador add column if not exists beneficios_mensal numeric not null default 0;

create or replace function rh_upsert_colaborador(p_org_id uuid, p_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if coalesce(nullif(p_data->>'nome',''), '') = '' then raise exception 'Nome é obrigatório'; end if;

  if p_id is null then
    insert into rh_colaborador (org_id, nome, cpf, email, telefone, cargo, tipo_vinculo,
      data_admissao, data_demissao, status, gestor_id, membro_user_id, salario_atual,
      beneficios_mensal, observacao, created_by)
    values (p_org_id,
      p_data->>'nome', nullif(p_data->>'cpf',''), nullif(p_data->>'email',''), nullif(p_data->>'telefone',''),
      nullif(p_data->>'cargo',''), nullif(p_data->>'tipo_vinculo',''),
      nullif(p_data->>'data_admissao','')::date, nullif(p_data->>'data_demissao','')::date,
      coalesce(nullif(p_data->>'status',''), 'ativo'),
      nullif(p_data->>'gestor_id','')::uuid, nullif(p_data->>'membro_user_id','')::uuid,
      nullif(p_data->>'salario_atual','')::numeric,
      coalesce(nullif(p_data->>'beneficios_mensal','')::numeric, 0),
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
      observacao = nullif(p_data->>'observacao',''), updated_at = now()
    where id = p_id and org_id = p_org_id
    returning id into v_id;
    if v_id is null then raise exception 'Colaborador não encontrado'; end if;
  end if;
  return v_id;
end; $$;

-- ── Overhead mensal da estrutura (interna) ───────────────────────────────────
-- Estrutura = saídas PAGAS (regime de caixa: data_liquidacao) das macros
-- 'Administrativo' e 'Financeiro', média dos últimos 3 meses fechados.
-- Fora de propósito: 'Pessoas' (já é camada direta), 'Impostos e Taxas' (entra
-- no preço como % sobre venda — contar aqui seria dobrar), 'Produção' (custo
-- direto de cliente), transferências/empréstimos (não são custo operacional).
create or replace function horas_overhead_mes(p_org uuid)
returns table (estrutura_mes numeric, provisao_lucro numeric, total_mes numeric)
language sql stable security definer set search_path to 'public' as $$
  with macros as (
    select f->>'nome' as categoria
    from org_settings s,
         jsonb_array_elements(coalesce(s.finance_categorias, '[]'::jsonb)) m,
         jsonb_array_elements(coalesce(m->'filhos', '[]'::jsonb)) f
    where s.org_id = p_org and m->>'nome' in ('Administrativo', 'Financeiro')
  ),
  base as (
    select coalesce(sum(coalesce(l.valor_realizado, l.valor)), 0) / 3.0 as media
    from lancamentos l
    where l.org_id = p_org and l.tipo = 'saida' and l.situacao = 'pago'
      and l.categoria in (select categoria from macros)
      and l.data_liquidacao >= (date_trunc('month', now()) - interval '3 months')::date
      and l.data_liquidacao <  date_trunc('month', now())::date
  )
  select round(b.media, 2),
         coalesce(s.custo_provisao_lucro, 0),
         round(b.media + coalesce(s.custo_provisao_lucro, 0), 2)
  from base b
  left join org_settings s on s.org_id = p_org;
$$;
revoke execute on function horas_overhead_mes(uuid) from anon, authenticated, public;

-- ── Composição por pessoa (última competência da folha) ──────────────────────
-- Expõe bruto/benefícios por pessoa → guarda rh_can (mesmo nível da folha).
create or replace function horas_custo_camadas(p_org uuid)
returns table (
  user_id uuid, nome text, comp date, clt boolean,
  bruto numeric, fgts numeric, encargos numeric, provisoes numeric, beneficios numeric,
  horas_uteis numeric, custo_direto_h numeric, overhead_h numeric, custo_hora numeric
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
           c.beneficios_mensal as benef,
           bool_or(f.categoria like '101%') as eh_clt,
           sum(coalesce(f.vencimentos, 0)) as fbruto,
           sum(coalesce(f.fgts, 0)) as ffgts,
           sum(coalesce(f.inss, 0)) as retido
    from rh_folha f
    join rh_colaborador c on c.id = f.colaborador_id and c.membro_user_id is not null
    where f.org_id = p_org and f.competencia = v_comp
    group by c.id, c.membro_user_id, c.nome, c.beneficios_mensal
  ),
  uteis as (
    -- horas úteis da pessoa: jornada (override ou padrão da org) × dias úteis − feriado abonado
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
                  480)) / 60.0 as hu
    from folha fo
  ),
  tot as (
    -- totais do time via window (sem temp table: a função é stable)
    select u.*,
           sum(u.hu) over () as horas_total,
           coalesce(nullif(sum(u.fbruto) over (), 0), 1) as bruto_total,
           sum(u.retido) over () as retido_total
    from uteis u
  ),
  guia as (
    -- custo-empresa da guia INSS = guia lançada − retido dos empregados (≥ 0).
    -- No Simples a CPP está no DAS → isto tende a 0, e é o comportamento certo.
    select t.*, greatest(0, coalesce((
      select sum(l.valor) from lancamentos l
      where l.org_id = p_org and l.origem_tipo = 'folha'
        and l.origem_ref = 'folha:' || v_comp || ':inss'
    ), 0) - t.retido_total) as custo_inss
    from tot t
  )
  select g.uid, g.cnome, v_comp, g.eh_clt,
         round(g.fbruto, 2), round(g.ffgts, 2),
         round(g.custo_inss * g.fbruto / g.bruto_total, 2) as encargos,
         round(case when g.eh_clt then g.fbruto * 0.21 else 0 end, 2) as provisoes,
         round(coalesce(g.benef, 0), 2),
         round(g.hu, 1),
         case when g.hu > 0 then round((g.fbruto + g.ffgts + g.custo_inss * g.fbruto / g.bruto_total
              + case when g.eh_clt then g.fbruto * 0.21 else 0 end
              + coalesce(g.benef, 0)) / g.hu, 2) end as custo_direto_h,
         case when g.horas_total > 0 then round(coalesce(v_over, 0) / g.horas_total, 2) end as overhead_h,
         case when g.hu > 0 and g.horas_total > 0 then
           round((g.fbruto + g.ffgts + g.custo_inss * g.fbruto / g.bruto_total
              + case when g.eh_clt then g.fbruto * 0.21 else 0 end
              + coalesce(g.benef, 0)) / g.hu
              + coalesce(v_over, 0) / g.horas_total, 2) end as custo_hora
  from guia g
  order by g.cnome;
end $$;
revoke execute on function horas_custo_camadas(uuid) from anon, authenticated, public;
grant execute on function horas_custo_camadas(uuid) to authenticated;

-- ── horas_custo_hora agora devolve o custo CHEIO (relatórios de Horas) ───────
-- Mesma assinatura da 167; guarda rh_can preservada; revoke preservado.
create or replace function horas_custo_hora(p_org uuid)
returns table (user_id uuid, comp date, custo_hora numeric)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_over numeric;
begin
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select total_mes into v_over from horas_overhead_mes(p_org);

  return query
  with folha as (
    select c.id as colaborador_id, c.membro_user_id as u, c.beneficios_mensal,
           date_trunc('month', f.competencia)::date as fcomp,
           bool_or(f.categoria like '101%') as clt,
           sum(coalesce(f.vencimentos, 0)) as bruto,
           sum(coalesce(f.fgts, 0)) as fgts,
           sum(coalesce(f.inss, 0)) as inss_retido,
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
    group by c.id, c.membro_user_id, c.beneficios_mensal, 4, 9, 10
  ),
  uteis as (
    select fo.*,
           (( select count(*)
              from generate_series(fo.fcomp::timestamp, (fo.fcomp + interval '1 month - 1 day')::timestamp, interval '1 day') d
              where extract(isodow from d)::int = any (fo.dias_semana)
                and not exists (select 1 from rh_feriado fe where fe.org_id = p_org and fe.data = d::date and fe.abona)
            ) * fo.carga_min) / 60.0 as hu
    from folha fo
  ),
  tot as (
    select fcomp, sum(hu) as horas_total, coalesce(nullif(sum(bruto), 0), 1) as bruto_total,
           sum(inss_retido) as retido_total
    from uteis group by 1
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
  select u.u, u.fcomp,
         case when u.hu > 0 and t.horas_total > 0 then
           round((u.bruto + u.fgts + g.custo_inss * u.bruto / t.bruto_total
              + case when u.clt then u.bruto * 0.21 else 0 end
              + coalesce(u.beneficios_mensal, 0)) / u.hu
              + coalesce(v_over, 0) / t.horas_total, 2) end
  from uteis u
  join tot t on t.fcomp = u.fcomp
  join guia g on g.fcomp = u.fcomp;
end $$;
revoke execute on function horas_custo_hora(uuid) from anon, authenticated, public;

-- ── Preço de venda da hora (agregado — sem salário individual) ───────────────
create or replace function horas_preco_venda(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_custo_medio numeric; v_horas numeric; v_imposto numeric; v_imposto_auto numeric;
  v_das numeric; v_recebido numeric; v_margem numeric; v_manual numeric;
  v_over record; v_comp date;
begin
  if not horas_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  select max(competencia) into v_comp from rh_folha where org_id = p_org;

  -- custo médio ponderado por horas úteis (da composição por pessoa)
  select sum(c.custo_hora * c.horas_uteis), sum(c.horas_uteis)
    into v_custo_medio, v_horas
  from horas_custo_camadas(p_org) c where c.custo_hora is not null;
  if coalesce(v_horas, 0) > 0 then v_custo_medio := round(v_custo_medio / v_horas, 2); end if;

  -- imposto efetivo: manual (config) ou automático = DAS pago ÷ recebido (12m, caixa)
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
revoke execute on function horas_preco_venda(uuid) from anon, authenticated, public;
grant execute on function horas_preco_venda(uuid) to authenticated;

notify pgrst, 'reload schema';
