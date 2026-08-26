-- 258_horas_custo_hora_materializa.sql
-- A tela de Horas passou a demorar ~8s por RPC depois da 257. MEDIDO em prod
-- (\timing): horas_custo_hora 7,9s; horas_por_pessoa 8,7s e horas_por_atividade
-- 6,9s (chamam ela por dentro) — com 701 marcações e 3.871 focos no banco.
--
-- Causa: a CTE `sess` (horas em tarefa por pessoa/mês) era referenciada SÓ
-- dentro de uma subquery correlacionada; o planner (PG12+) inlinou a CTE e
-- horas_sessoes() — ~400ms por execução — passou a rodar POR LINHA (~20×).
-- Correção: `as materialized` + LEFT JOIN, executa UMA vez. Mesmo resultado.

create or replace function horas_custo_hora(p_org uuid)
returns table(user_id uuid, comp date, custo_hora numeric)
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
  -- MATERIALIZED de propósito: referenciada via join, tem que rodar UMA vez —
  -- inline aqui já custou 7,9s (horas_sessoes por linha).
  sess as materialized (
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
           coalesce(se.ht, 0) as ht
    from pessoas fo
    join jornada j on j.colaborador_id = fo.colaborador_id
    left join sess se on se.su = fo.u and se.sm = fo.fcomp
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

notify pgrst, 'reload schema';
