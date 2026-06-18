-- Arquivar/desarquivar cliente (workspace) e campanha. Colunas já existem
-- (workspaces.archived nativo; campaigns.archived na 022). Idempotente.

create or replace function set_workspace_archived(
  p_user_id uuid, p_workspace_id uuid, p_archived boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from workspaces w
    join organization_members m on m.org_id = w.org_id
    where w.id = p_workspace_id and m.user_id = p_user_id and m.role in ('owner','admin','manager')
  ) then
    raise exception 'Acesso negado';
  end if;
  update workspaces set archived = p_archived where id = p_workspace_id;
end; $$;

create or replace function set_campaign_archived(
  p_user_id uuid, p_campaign_id uuid, p_archived boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from campaigns c
    join workspaces w on w.id = c.workspace_id
    join organization_members m on m.org_id = w.org_id
    where c.id = p_campaign_id and m.user_id = p_user_id and m.role in ('owner','admin','manager')
  ) then
    raise exception 'Acesso negado';
  end if;
  update campaigns set archived = p_archived where id = p_campaign_id;
end; $$;

grant execute on function set_workspace_archived(uuid, uuid, boolean) to anon, authenticated;
grant execute on function set_campaign_archived(uuid, uuid, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
