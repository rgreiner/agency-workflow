-- 244_fix_cron_rpc_exposta.sql
-- P0 de segurança (achado na revisão de 15/08): `digest_payload()` era
-- executável por `anon` — qualquer um com a chave pública (que vai no bundle do
-- site) recebia, SEM LOGIN, os e-mails, nomes e tarefas de TODAS as pessoas de
-- TODAS as organizações. Confirmado por HTTP contra o PostgREST público.
--
-- Duas frestas, fechadas juntas:
--  1. GRANT para anon/public → REVOKE. Só `authenticated` executa (o cron usa
--     um JWT authenticated).
--  2. Faltava o guard interno: mesmo logado, um membro comum não tem nada que
--     ver o digest de todo mundo. Estas três RPCs são do CRON e de mais ninguém
--     (nenhum uso fora de src/lib/cron/) — então exigem `is_cron()`, o mesmo
--     claim `flow_cron` que o createCronClient assina (migration 183).
--
-- Defense-in-depth: o guard no corpo protege mesmo que um `create or replace`
-- futuro reintroduza o grant, e o revoke protege mesmo que o guard seja
-- removido. As duas camadas são de propósito.
--
-- O corpo do digest_payload é o mesmo da 241 (agregação intocada) — só entrou a
-- linha `and is_cron()`. Idempotente.

create or replace function digest_payload()
returns jsonb language sql stable security definer set search_path = public as $$
  with today as (select (now() at time zone 'America/Sao_Paulo')::date as d),
  tasks as (
    select aa.user_id, a.id, a.title, a.due_date::text as due,
           c.name as campaign, w.name as cliente, o.slug as org_slug,
           case when a.due_date <  (select d from today) then 'atrasadas'
                when a.due_date =  (select d from today) then 'hoje'
                else 'proximas' end as bucket
    from activity_assignees aa
    join activities a  on a.id = aa.activity_id
    join campaigns  c  on c.id = a.campaign_id
    join workspaces w  on w.id = c.workspace_id
    join organizations o on o.id = w.org_id
    where a.archived = false and a.status <> 'concluido' and a.due_date is not null
      and a.due_date <= (select d from today) + 7
  ),
  agg as (
    select t.user_id, max(t.org_slug) as org_slug,
      jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'due',t.due,'campaign',t.campaign,'cliente',t.cliente) order by t.due)
        filter (where t.bucket='atrasadas') as atrasadas,
      jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'due',t.due,'campaign',t.campaign,'cliente',t.cliente) order by t.due)
        filter (where t.bucket='hoje')      as hoje,
      jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'due',t.due,'campaign',t.campaign,'cliente',t.cliente) order by t.due)
        filter (where t.bucket='proximas')  as proximas
    from tasks t
    group by t.user_id
  ),
  gente_midia as (
    select m.user_id, m.org_id, o.slug as org_slug
      from organization_members m
      join organizations o on o.id = m.org_id
      left join org_positions p on p.id = m.position_id
     where m.arquivado = false
       and (m.role in ('owner','admin') or coalesce(p.op_ver_tudo,false) or coalesce(p.op_midia_hub,false))
  ),
  entregas as (
    select e.org_id, e.id, e.titulo, e.prazo_envio::text as prazo,
           e.veiculo, w.name as cliente,
           (a.id is not null and a.status not in (
              select s.valor from org_status s
               where s.org_id = e.org_id
                 and (s.papel = 'conclusao' or s.valor in ('validacao_midia','midia','social','implantacao_digital','implantacao_off'))
            )) as com_criacao
      from midia_entrega e
      join workspaces w on w.id = e.workspace_id
      left join activities a on a.id = e.activity_id
     where e.situacao = 'aguardando'
       and e.prazo_envio is not null
       and e.prazo_envio <= (select d from today) + 7
  ),
  entregas_agg as (
    select g.user_id, max(g.org_slug) as org_slug,
      jsonb_agg(jsonb_build_object(
        'id', e.id, 'titulo', e.titulo, 'prazo', e.prazo, 'cliente', e.cliente,
        'veiculo', e.veiculo, 'com_criacao', e.com_criacao
      ) order by e.prazo) as entregas
    from gente_midia g
    join entregas e on e.org_id = g.org_id
    group by g.user_id
  ),
  pessoas as (
    select coalesce(a.user_id, ea.user_id) as user_id,
           coalesce(a.org_slug, ea.org_slug) as org_slug,
           a.atrasadas, a.hoje, a.proximas, ea.entregas
      from agg a
      full outer join entregas_agg ea on ea.user_id = a.user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'email', p.email, 'name', p.full_name, 'org_slug', x.org_slug,
           'atrasadas', coalesce(x.atrasadas, '[]'::jsonb),
           'hoje',      coalesce(x.hoje,      '[]'::jsonb),
           'proximas',  coalesce(x.proximas,  '[]'::jsonb),
           'entregas',  coalesce(x.entregas,  '[]'::jsonb)
         )), '[]'::jsonb)
  from pessoas x
  join profiles p on p.id = x.user_id
  where is_cron()   -- ⬅️ o guard: só o cron monta o digest de todo mundo
    and p.email is not null
    and coalesce((select up.digest_enabled from user_prefs up where up.user_id = x.user_id), true)
    and (x.atrasadas is not null or x.hoje is not null or x.proximas is not null or x.entregas is not null);
$$;

revoke execute on function digest_payload() from anon, public;
grant  execute on function digest_payload() to authenticated;

-- Status dos jobs: expunha infra (horários, falhas do btg-sync) para anon.
create or replace function list_cron_runs()
returns setof cron_runs language sql stable security definer set search_path = public as $$
  select * from cron_runs where is_cron()
$$;
revoke execute on function list_cron_runs() from anon, public;
grant  execute on function list_cron_runs() to authenticated;

-- Escrita na tabela de status dos jobs: anon podia poluir/falsear o histórico.
create or replace function mark_cron_run(p_job text, p_status text, p_detail text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_cron() then raise exception 'Acesso negado' using errcode = '42501'; end if;
  insert into cron_runs (job, last_run_at, last_status, last_detail, updated_at)
  values (p_job, now(), p_status, left(coalesce(p_detail,''), 500), now())
  on conflict (job) do update set
    last_run_at = now(), last_status = excluded.last_status,
    last_detail = excluded.last_detail, updated_at = now();
end; $$;
revoke execute on function mark_cron_run(text, text, text) from anon, public;
grant  execute on function mark_cron_run(text, text, text) to authenticated;

notify pgrst, 'reload schema';
