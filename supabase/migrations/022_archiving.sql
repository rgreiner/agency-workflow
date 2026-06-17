-- Arquivamento de tarefas (e coluna pronta para campanhas).
-- Idempotente: add column if not exists + create or replace.

alter table activities add column if not exists archived    boolean not null default false;
alter table activities add column if not exists archived_at timestamptz;
alter table campaigns  add column if not exists archived    boolean not null default false;

create index if not exists idx_activities_archived on activities(archived);

-- Arquiva/desarquiva uma tarefa (qualquer membro da org).
create or replace function set_activity_archived(
  p_user_id     uuid,
  p_activity_id uuid,
  p_archived    boolean
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    join organization_members m on m.org_id = w.org_id
    where a.id = p_activity_id and m.user_id = p_user_id
  ) then
    raise exception 'Acesso negado';
  end if;

  update activities
     set archived    = p_archived,
         archived_at = case when p_archived then now() else null end
   where id = p_activity_id;
end;
$$;

grant execute on function set_activity_archived(uuid, uuid, boolean) to anon, authenticated;

-- Faz o PostgREST recarregar o schema (enxergar a coluna e a RPC novas).
notify pgrst, 'reload schema';
