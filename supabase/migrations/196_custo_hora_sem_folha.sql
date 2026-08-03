-- 196_custo_hora_sem_folha.sql
-- Auditoria 02/08, RH: "O custo do tempo zera em silêncio no mês sem folha
-- importada".
--
-- A causa está numa linha: o conjunto de competências saía de dentro da própria
-- folha (`select distinct competencia from rh_folha`). Mês sem folha não existia
-- para a função, ninguém aparecia, e `horas_por_pessoa` devolvia custo nulo —
-- que a tela mostra como vazio. Medido: só a competência 07/2026 foi importada,
-- então TODO o resto do ano está assim.
--
-- Regra do Rafael (03/08): "podemos usar o custo do funcionário ao invés da
-- folha, porém a folha precisa ser importada todos os meses" — ou seja, a ficha
-- é rede de segurança, não substituto. Então: o mês sem folha passa a valer pelo
-- `salario_atual` da ficha, e a tela diz que aquele mês é estimado.
--
-- Duas correções que vêm junto, no caminho da ficha:
--   · CLT que cai na ficha volta a receber os 22% de provisão (antes o ramo da
--     ficha fixava `clt = false`, o que fazia sentido quando ele só atendia
--     estagiário e terceiro).
--   · FGTS estimado em 8% do bruto — é alíquota legal, não chute. Sem isso o mês
--     estimado sairia sistematicamente mais barato que o mês com folha, e a
--     comparação entre meses enganaria.
--
-- Idempotente.

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
  -- O universo de meses não pode mais sair da folha. Vai do primeiro mês em que
  -- houve folha OU trabalho registrado até o mês corrente.
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
    -- Fora da folha daquela competência, ativo com login: entra pela ficha.
    -- Cobre os dois casos: estagiário/terceiro (que nunca estão na folha) e
    -- qualquer pessoa num mês em que a folha não foi importada.
    select c.id, c.membro_user_id, c.beneficios_mensal, x.fcomp,
           (c.tipo_vinculo = 'clt') as clt,
           coalesce(c.salario_atual, 0) as bruto,
           case when c.tipo_vinculo = 'clt' then round(coalesce(c.salario_atual, 0) * 0.08, 2) else 0 end as fgts,
           0::numeric as inss_retido,
           'ficha'::text as origem
    from rh_colaborador c
    cross join comps x
    where c.org_id = p_org and c.membro_user_id is not null
      and coalesce(c.arquivado, false) = false and c.status = 'ativo'
      and coalesce(c.salario_atual, 0) + coalesce(c.beneficios_mensal, 0) > 0
      -- Nunca antes de ser contratado: o universo de meses agora começa no
      -- primeiro registro de trabalho da ORG, que pode ser anterior à admissão.
      and (c.data_admissao is null or x.fcomp >= date_trunc('month', c.data_admissao)::date)
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

revoke execute on function horas_custo_hora(uuid) from public, anon;
grant  execute on function horas_custo_hora(uuid) to authenticated;

-- ── Quais meses estão estimados ─────────────────────────────────────────────
-- A tela precisa dizer "este mês é estimado". Função separada de propósito:
-- mexer no retorno de horas_custo_hora obrigaria a recriar horas_por_pessoa e
-- horas_por_atividade junto, por um selo.
create or replace function horas_competencias_estimadas(p_org uuid)
returns table(comp date, pessoas int) language plpgsql stable security definer
set search_path to 'public' as $$
begin
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  return query
  with comps as (
    select generate_series(
      least(
        coalesce((select min(date_trunc('month', f.competencia))::date from rh_folha f where f.org_id = p_org),
                 date_trunc('month', current_date)::date),
        coalesce((select min(date_trunc('month', af.aberta_em))::date from activity_focus af where af.org_id = p_org),
                 date_trunc('month', current_date)::date)
      ),
      date_trunc('month', current_date)::date,
      interval '1 month')::date as fcomp
  )
  select x.fcomp,
         count(*)::int
    from comps x
    join rh_colaborador c
      on c.org_id = p_org and c.membro_user_id is not null
     and coalesce(c.arquivado, false) = false and c.status = 'ativo'
     and c.tipo_vinculo = 'clt'   -- estagiário e terceiro NUNCA estão na folha; não é estimativa, é o modelo
     and (c.data_admissao is null or x.fcomp >= date_trunc('month', c.data_admissao)::date)
   where not exists (select 1 from rh_folha f
                     where f.org_id = p_org and f.colaborador_id = c.id
                       and date_trunc('month', f.competencia)::date = x.fcomp)
   group by x.fcomp
   order by x.fcomp;
end $$;

revoke execute on function horas_competencias_estimadas(uuid) from public, anon;
grant  execute on function horas_competencias_estimadas(uuid) to authenticated;

notify pgrst, 'reload schema';
