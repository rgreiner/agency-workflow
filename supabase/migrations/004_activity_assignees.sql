-- Responsáveis por atividade (many-to-many)
create table if not exists activity_assignees (
  activity_id uuid not null references activities(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (activity_id, user_id)
);

alter table activity_assignees enable row level security;

create policy "Org members can read assignees" on activity_assignees for select
  using (exists (
    select 1 from activities a join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    join organization_members m on m.org_id = w.org_id
    where a.id = activity_id and m.user_id = auth.uid()
  ));

create index if not exists idx_activity_assignees_activity on activity_assignees(activity_id);
create index if not exists idx_activity_assignees_user on activity_assignees(user_id);

-- Toggle responsável (adiciona ou remove)
create or replace function toggle_activity_assignee(
  p_user_id      uuid,
  p_activity_id  uuid,
  p_assignee_id  uuid
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_exists boolean;
begin
  if not exists (
    select 1 from activities a join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    join organization_members m on m.org_id = w.org_id
    where a.id = p_activity_id and m.user_id = p_user_id
  ) then
    raise exception 'Acesso negado';
  end if;

  select exists(
    select 1 from activity_assignees
    where activity_id = p_activity_id and user_id = p_assignee_id
  ) into v_exists;

  if v_exists then
    delete from activity_assignees where activity_id = p_activity_id and user_id = p_assignee_id;
    return false;
  else
    insert into activity_assignees (activity_id, user_id) values (p_activity_id, p_assignee_id);
    return true;
  end if;
end;
$$;

grant execute on function toggle_activity_assignee(uuid,uuid,uuid) to anon, authenticated;
