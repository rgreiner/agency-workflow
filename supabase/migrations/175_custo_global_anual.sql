-- 175_custo_global_anual.sql
-- Custo de pessoal alinhado ao controle anual do Rafael (Excel de provisão):
--   • Provisões CLT: 21% → 22% (entra o AVISO PRÉVIO indenizado ~1%/mês, que o
--     Excel provisiona e o modelo não tinha). 13º 8,33 + férias+⅓ 11,11 + FGTS
--     sobre ambos ~1,6 + aviso 1.
--   • Quem NÃO vem na folha da contabilidade (estagiário bolsa+CIEE, terceiro
--     fixo) mas está ATIVO com login entra pela FICHA: bruto = salario_atual,
--     benefícios = beneficios_mensal; sem FGTS/encargos/provisões. Sem isso o
--     custo do time (e o rateio do overhead) ignora gente que abre tarefa.
--   • horas_custo_camadas ganha a coluna `fonte` ('folha' | 'ficha') — assinatura
--     nova → drop antes (PostgREST: 1 assinatura por RPC).
-- O rateio da guia INSS continua SÓ entre quem está na folha (a guia não inclui
-- estagiário); o overhead rateia pelas horas de TODO o time. Idempotente.

drop function if exists horas_custo_camadas(uuid);

create or replace function horas_custo_camadas(p_org uuid)
returns table (
  user_id uuid, nome text, comp date, clt boolean, fonte text,
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
           sum(coalesce(f.inss, 0)) as retido,
           'folha'::text as origem
    from rh_folha f
    join rh_colaborador c on c.id = f.colaborador_id and c.membro_user_id is not null
    where f.org_id = p_org and f.competencia = v_comp
    group by c.id, c.membro_user_id, c.nome, c.beneficios_mensal
  ),
  ficha as (
    -- Ativo com login, fora da folha da competência: estagiário/terceiro fixo.
    select c.id, c.membro_user_id, c.nome, c.beneficios_mensal,
           false, coalesce(c.salario_atual, 0), 0::numeric, 0::numeric, 'ficha'::text
    from rh_colaborador c
    where c.org_id = p_org and c.membro_user_id is not null
      and coalesce(c.arquivado, false) = false and c.status = 'ativo'
      and coalesce(c.salario_atual, 0) + coalesce(c.beneficios_mensal, 0) > 0
      and not exists (select 1 from rh_folha f
                      where f.org_id = p_org and f.competencia = v_comp and f.colaborador_id = c.id)
  ),
  pessoas as (
    select * from folha union all select * from ficha
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
    from pessoas fo
  ),
  tot as (
    -- overhead rateia por TODAS as horas; a guia INSS só entre o bruto da FOLHA
    select u.*,
           sum(u.hu) over () as horas_total,
           coalesce(nullif(sum(u.fbruto) filter (where u.origem = 'folha') over (), 0), 1) as bruto_total_folha,
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
  select g.uid, g.cnome, v_comp, g.eh_clt, g.origem,
         round(g.fbruto, 2), round(g.ffgts, 2),
         round(case when g.origem = 'folha' then g.custo_inss * g.fbruto / g.bruto_total_folha else 0 end, 2) as encargos,
         round(case when g.eh_clt then g.fbruto * 0.22 else 0 end, 2) as provisoes,
         round(coalesce(g.benef, 0), 2),
         round(g.hu, 1),
         case when g.hu > 0 then round((g.fbruto + g.ffgts
              + case when g.origem = 'folha' then g.custo_inss * g.fbruto / g.bruto_total_folha else 0 end
              + case when g.eh_clt then g.fbruto * 0.22 else 0 end
              + coalesce(g.benef, 0)) / g.hu, 2) end as custo_direto_h,
         case when g.horas_total > 0 then round(coalesce(v_over, 0) / g.horas_total, 2) end as overhead_h,
         case when g.hu > 0 and g.horas_total > 0 then
           round((g.fbruto + g.ffgts
              + case when g.origem = 'folha' then g.custo_inss * g.fbruto / g.bruto_total_folha else 0 end
              + case when g.eh_clt then g.fbruto * 0.22 else 0 end
              + coalesce(g.benef, 0)) / g.hu
              + coalesce(v_over, 0) / g.horas_total, 2) end as custo_hora
  from guia g
  order by g.cnome;
end $$;
revoke execute on function horas_custo_camadas(uuid) from anon, authenticated, public;
grant execute on function horas_custo_camadas(uuid) to authenticated;

-- ── horas_custo_hora (relatórios): mesmas duas regras, por competência ────────
create or replace function horas_custo_hora(p_org uuid)
returns table (user_id uuid, comp date, custo_hora numeric)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_over numeric;
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
  folha as (
    select c.id as colaborador_id, c.membro_user_id as u, c.beneficios_mensal,
           date_trunc('month', f.competencia)::date as fcomp,
           bool_or(f.categoria like '101%') as clt,
           sum(coalesce(f.vencimentos, 0)) as bruto,
           sum(coalesce(f.fgts, 0)) as fgts,
           sum(coalesce(f.inss, 0)) as inss_retido,
           'folha'::text as origem
    from rh_folha f
    join rh_colaborador c on c.id = f.colaborador_id and c.membro_user_id is not null
    where f.org_id = p_org
    group by c.id, c.membro_user_id, c.beneficios_mensal, 4
  ),
  ficha as (
    -- fora da folha daquela competência, ativo com login: entra pela ficha
    select c.id, c.membro_user_id, c.beneficios_mensal, x.fcomp,
           false, coalesce(c.salario_atual, 0), 0::numeric, 0::numeric, 'ficha'::text
    from rh_colaborador c
    cross join (select distinct date_trunc('month', competencia)::date as fcomp
                from rh_folha where org_id = p_org) x
    where c.org_id = p_org and c.membro_user_id is not null
      and coalesce(c.arquivado, false) = false and c.status = 'ativo'
      and coalesce(c.salario_atual, 0) + coalesce(c.beneficios_mensal, 0) > 0
      and not exists (select 1 from rh_folha f
                      where f.org_id = p_org and f.colaborador_id = c.id
                        and date_trunc('month', f.competencia)::date = x.fcomp)
  ),
  pessoas as (
    select * from folha union all select * from ficha
  ),
  uteis as (
    select fo.*, j.carga_min, j.dias_semana,
           (( select count(*)
              from generate_series(fo.fcomp::timestamp, (fo.fcomp + interval '1 month - 1 day')::timestamp, interval '1 day') d
              where extract(isodow from d)::int = any (j.dias_semana)
                and not exists (select 1 from rh_feriado fe where fe.org_id = p_org and fe.data = d::date and fe.abona)
            ) * j.carga_min) / 60.0 as hu
    from pessoas fo
    join jornada j on j.colaborador_id = fo.colaborador_id
  ),
  tot as (
    select fcomp, sum(hu) as horas_total,
           coalesce(nullif(sum(bruto) filter (where origem = 'folha'), 0), 1) as bruto_total_folha,
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
           round((u.bruto + u.fgts
              + case when u.origem = 'folha' then g.custo_inss * u.bruto / t.bruto_total_folha else 0 end
              + case when u.clt then u.bruto * 0.22 else 0 end
              + coalesce(u.beneficios_mensal, 0)) / u.hu
              + coalesce(v_over, 0) / t.horas_total, 2) end
  from uteis u
  join tot t on t.fcomp = u.fcomp
  join guia g on g.fcomp = u.fcomp;
end $$;
revoke execute on function horas_custo_hora(uuid) from anon, authenticated, public;

notify pgrst, 'reload schema';
