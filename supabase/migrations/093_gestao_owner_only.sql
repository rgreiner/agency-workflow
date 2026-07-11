-- 093_gestao_owner_only.sql
-- Dashboard gerencial passa a ser acessível SÓ ao proprietário (owner) do ambiente
-- — antes era owner/admin/manager. Trava na própria RPC (defesa em profundidade:
-- nem via PostgREST direto um admin/manager lê). Redefine as 2 RPCs. Idempotente.

create or replace function dashboard_gestao(p_user_id uuid, p_org_id uuid, p_ws uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_role text;
begin
  select role into v_role from organization_members where org_id = p_org_id and user_id = p_user_id;
  if v_role is null or v_role <> 'owner' then raise exception 'Acesso negado'; end if;

  with base as (
    select a.id, a.status::text as status, a.due_date, a.estimated_hours, a.created_at,
           w.id as ws_id, w.name as ws_name
    from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    where w.org_id = p_org_id and a.archived = false
      and (p_ws is null or cardinality(p_ws) = 0 or w.id = any(p_ws))
  ),
  ativa as (select * from base where status <> 'concluido'),
  asg as (
    select aa.activity_id, array_agg(aa.user_id) as uids
    from activity_assignees aa join ativa b on b.id = aa.activity_id
    group by aa.activity_id
  ),
  last_move as (
    select b.id, coalesce(max(h.changed_at), b.created_at) as last_at
    from ativa b left join activity_history h on h.activity_id = b.id
    group by b.id, b.created_at
  ),
  atrasadas as (
    select b.status, b.ws_id, b.ws_name,
           coalesce(a.uids, '{}'::uuid[]) as assignees,
           (current_date - b.due_date::date) as dias
    from ativa b left join asg a on a.activity_id = b.id
    where b.due_date is not null and b.due_date::date < current_date
  ),
  paradas as (
    select b.status, b.ws_id, b.ws_name,
           coalesce(a.uids, '{}'::uuid[]) as assignees,
           extract(day from now() - lm.last_at)::int as dias
    from ativa b join last_move lm on lm.id = b.id left join asg a on a.activity_id = b.id
    where lm.last_at < now() - interval '7 days'
  ),
  carga as (
    select aa.user_id, p.full_name, p.avatar_url,
           count(*) as ativas, coalesce(sum(b.estimated_hours), 0)::numeric as horas
    from ativa b
    join activity_assignees aa on aa.activity_id = b.id
    join profiles p on p.id = aa.user_id
    group by aa.user_id, p.full_name, p.avatar_url
  ),
  funil as (select status, count(*) as n from ativa group by status)
  select jsonb_build_object(
    'total_ativas',     (select count(*) from ativa),
    'n_atrasadas',      (select count(*) from atrasadas),
    'n_sem_responsavel',(select count(*) from ativa b left join asg a on a.activity_id = b.id where a.activity_id is null),
    'n_sem_prazo',      (select count(*) from ativa where due_date is null),
    'n_paradas',        (select count(*) from paradas),
    'atrasadas', coalesce((select jsonb_agg(row_to_json(t)) from
      (select status, ws_id, ws_name, assignees, dias from atrasadas) t), '[]'),
    'paradas', coalesce((select jsonb_agg(row_to_json(t)) from
      (select status, ws_id, ws_name, assignees, dias from paradas) t), '[]'),
    'carga', coalesce((select jsonb_agg(row_to_json(t)) from
      (select user_id, full_name, avatar_url, ativas, horas from carga order by ativas desc, horas desc) t), '[]'),
    'funil', coalesce((select jsonb_agg(row_to_json(t)) from
      (select status, n from funil) t), '[]')
  ) into v;
  return v;
end $$;

create or replace function dashboard_engajamento(p_user_id uuid, p_org_id uuid, p_days int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_role text; v_since timestamptz; v_days int;
begin
  select role into v_role from organization_members where org_id = p_org_id and user_id = p_user_id;
  if v_role is null or v_role <> 'owner' then raise exception 'Acesso negado'; end if;
  v_days := least(greatest(coalesce(p_days, 84), 7), 372);
  v_since := (current_date - (v_days - 1)) ::timestamptz;

  with ev as (
    select h.changed_by as uid, h.changed_at as ts, 'status' as kind
      from activity_history h
      join activities a on a.id = h.activity_id
      join campaigns c on c.id = a.campaign_id
      join workspaces w on w.id = c.workspace_id
      where w.org_id = p_org_id and h.changed_at >= v_since and h.changed_by is not null
    union all
    select fh.changed_by, fh.changed_at, 'campo'
      from activity_field_history fh
      join activities a on a.id = fh.activity_id
      join campaigns c on c.id = a.campaign_id
      join workspaces w on w.id = c.workspace_id
      where w.org_id = p_org_id and fh.changed_at >= v_since
    union all
    select cm.user_id, cm.created_at, 'comentario'
      from activity_comments cm
      join activities a on a.id = cm.activity_id
      join campaigns c on c.id = a.campaign_id
      join workspaces w on w.id = c.workspace_id
      where w.org_id = p_org_id and cm.created_at >= v_since
    union all
    select r.user_id, r.created_at, 'reacao'
      from activity_comment_reactions r
      join activity_comments cm on cm.id = r.comment_id
      join activities a on a.id = cm.activity_id
      join campaigns c on c.id = a.campaign_id
      join workspaces w on w.id = c.workspace_id
      where w.org_id = p_org_id and r.created_at >= v_since
  ),
  daily as (
    select uid, (ts at time zone 'America/Sao_Paulo')::date as day, count(*) as n
    from ev group by uid, (ts at time zone 'America/Sao_Paulo')::date
  ),
  tot as (select uid, kind, count(*) as n from ev group by uid, kind)
  select jsonb_build_object(
    'since', (current_date - (v_days - 1)),
    'until', current_date,
    'days',  v_days,
    'users', coalesce((select jsonb_agg(row_to_json(t) order by (t.total) desc) from (
        select u.uid as user_id, p.full_name, p.avatar_url,
               (select count(*) from ev e where e.uid = u.uid) as total,
               coalesce((select jsonb_object_agg(kind, n) from tot tb where tb.uid = u.uid), '{}'::jsonb) as por_tipo
        from (select distinct uid from ev) u
        join profiles p on p.id = u.uid
      ) t), '[]'),
    'daily', coalesce((select jsonb_agg(row_to_json(t)) from
      (select uid as user_id, day, n from daily) t), '[]')
  ) into v;
  return v;
end $$;

notify pgrst, 'reload schema';
