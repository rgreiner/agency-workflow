-- 092_dashboard_gestao_analitico.sql
-- Redefine dashboard_gestao p/ ser ANALÍTICO (não lista de tarefas): devolve os
-- conjuntos de "problema" (atrasadas / paradas) já com status, cliente, responsáveis
-- e dias — o cliente agrega por etapa/pessoa/cliente/severidade e cruza por avatar.
-- Nomes de tarefa NÃO vêm (isso é o Trabalhar). Mesma assinatura (create or replace).

create or replace function dashboard_gestao(p_user_id uuid, p_org_id uuid, p_ws uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_role text;
begin
  select role into v_role from organization_members where org_id = p_org_id and user_id = p_user_id;
  if v_role is null or v_role not in ('owner','admin','manager') then raise exception 'Acesso negado'; end if;

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

grant execute on function dashboard_gestao(uuid, uuid, uuid[]) to anon, authenticated;

notify pgrst, 'reload schema';
