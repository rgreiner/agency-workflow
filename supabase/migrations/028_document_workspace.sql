-- Associar um documento a um cliente (workspace) — ou deixá-lo no nível da org.
-- Escrita via RPC security definer (padrão do app), checando permissão.

create or replace function set_document_workspace(p_user_id uuid, p_doc_id uuid, p_workspace_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_user_manage_doc(p_user_id, p_doc_id) then raise exception 'Acesso negado'; end if;
  if p_workspace_id is not null and not exists (
    select 1 from workspaces w join documents d on d.id = p_doc_id
    where w.id = p_workspace_id and w.org_id = d.org_id
  ) then raise exception 'Cliente inválido'; end if;
  update documents set workspace_id = p_workspace_id where id = p_doc_id;
end; $$;

grant execute on function set_document_workspace(uuid, uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
