-- 167_horas_fecha_internas.sql
-- Fecha as duas funções INTERNAS do relatório de horas (166).
--
-- Achado na verificação pós-deploy: `revoke execute ... from public` NÃO bastou.
-- O banco tem default privileges dando execute a `authenticated` em funções novas
-- do schema public, então `horas_sessoes` e `horas_custo_hora` — ambas SECURITY
-- DEFINER e SEM guarda de permissão, porque a guarda estava só nas funções que as
-- chamam — ficaram chamáveis por QUALQUER usuário logado via PostgREST, passando
-- `p_org` arbitrário. Vazava quem trabalhou em quê e, pior, o custo/hora por
-- pessoa (do qual se deduz salário). Mesma classe do P0 da auditoria de 22/07.
--
-- Duas travas: revoke explícito (anon/authenticated) E guarda dentro da função,
-- pra não voltar a vazar se alguém reconceder o grant algum dia.

revoke execute on function horas_sessoes(uuid, date, date) from anon, authenticated, public;
revoke execute on function horas_custo_hora(uuid) from anon, authenticated, public;

create or replace function horas_sessoes(p_org uuid, p_ini date, p_fim date)
returns table (
  user_id uuid, activity_id uuid, dia date,
  inicio timestamptz, fim timestamptz, minutos numeric, sem_sinal_min numeric
)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not horas_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  return query
  with foco as (
    select f.user_id, f.activity_id, f.aberta_em, f.ping_em,
           (f.aberta_em at time zone 'America/Sao_Paulo')::date as dia,
           lead(f.aberta_em) over (partition by f.user_id order by f.aberta_em) as prox
    from activity_focus f
    where f.org_id = p_org
      and f.aberta_em >= ((p_ini::timestamp) at time zone 'America/Sao_Paulo')
      and f.aberta_em <  (((p_fim + 1)::timestamp) at time zone 'America/Sao_Paulo')
  ),
  pares as (
    select c.membro_user_id as u, p.data as dia,
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
    select f.user_id as u, f.activity_id as a, f.dia as d, f.ping_em,
           greatest(f.aberta_em, pr.ini) as ini,
           least(coalesce(f.prox, 'infinity'::timestamptz), pr.fim) as fim
    from foco f
    join pares pr on pr.u = f.user_id and pr.dia = f.dia
  )
  select c.u, c.a, c.d, c.ini, c.fim,
         round((extract(epoch from (c.fim - c.ini)) / 60.0)::numeric, 2),
         round(greatest(0, extract(epoch from (c.fim - greatest(c.ini, c.ping_em))) / 60.0)::numeric, 2)
  from corte c
  where c.fim > c.ini;
end $$;
revoke execute on function horas_sessoes(uuid, date, date) from anon, authenticated, public;

create or replace function horas_custo_hora(p_org uuid)
returns table (user_id uuid, comp date, custo_hora numeric)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  -- Custo/hora deriva salário: só RH enxerga (as telas já filtram, mas a função
  -- é o limite real).
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  return query
  with folha as (
    select c.id as colaborador_id, c.membro_user_id as u,
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
    select fo.u, fo.comp, fo.custo_mes,
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
    group by 1, 2, 3, fo.carga_min
  )
  select x.u, x.comp,
         case when x.horas_mes > 0 then round((x.custo_mes / x.horas_mes)::numeric, 2) end
  from uteis x;
end $$;
revoke execute on function horas_custo_hora(uuid) from anon, authenticated, public;

notify pgrst, 'reload schema';
