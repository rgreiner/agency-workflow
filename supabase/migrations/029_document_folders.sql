-- Pastas de documentos (1 nível). Uma pasta é um document com is_folder=true;
-- os documentos dentro dela apontam via parent_id. Tudo via RPC security definer.

alter table documents add column if not exists is_folder boolean not null default false;

-- create_document passa a aceitar p_parent_id (criar documento dentro de pasta).
drop function if exists create_document(uuid, uuid, uuid);
create or replace function create_document(p_user_id uuid, p_org_id uuid, p_workspace_id uuid, p_parent_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (select 1 from organization_members where org_id = p_org_id and user_id = p_user_id)
  then raise exception 'Acesso negado'; end if;
  insert into documents (org_id, workspace_id, parent_id, title, content, visibility, created_by)
  values (p_org_id, p_workspace_id, p_parent_id, 'Sem título', '{"type":"doc","content":[]}'::jsonb, 'org', p_user_id)
  returning id into v_id;
  return v_id;
end; $$;

create or replace function create_folder(p_user_id uuid, p_org_id uuid, p_workspace_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (select 1 from organization_members where org_id = p_org_id and user_id = p_user_id)
  then raise exception 'Acesso negado'; end if;
  insert into documents (org_id, workspace_id, parent_id, title, content, visibility, created_by, is_folder)
  values (p_org_id, p_workspace_id, null, coalesce(nullif(trim(p_name), ''), 'Nova pasta'), '{"type":"doc","content":[]}'::jsonb, 'org', p_user_id, true)
  returning id into v_id;
  return v_id;
end; $$;

-- Mover documento para dentro/fora de uma pasta (e ajustar o cliente junto).
create or replace function move_document(p_user_id uuid, p_doc_id uuid, p_parent_id uuid, p_workspace_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_user_manage_doc(p_user_id, p_doc_id) then raise exception 'Acesso negado'; end if;
  update documents set parent_id = p_parent_id, workspace_id = p_workspace_id where id = p_doc_id;
end; $$;

grant execute on function create_document(uuid, uuid, uuid, uuid) to anon, authenticated;
grant execute on function create_folder(uuid, uuid, uuid, text)   to anon, authenticated;
grant execute on function move_document(uuid, uuid, uuid, uuid)    to anon, authenticated;

notify pgrst, 'reload schema';
