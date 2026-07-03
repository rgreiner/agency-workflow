-- 079_nested_folders.sql
-- Pastas dentro de pastas: create_folder aceita p_parent_id (subpasta) e
-- move_document evita ciclo (mover uma pasta pra dentro dela mesma/descendente).
-- Idempotente.

drop function if exists create_folder(uuid, uuid, uuid, text);
create or replace function create_folder(
  p_user_id uuid, p_org_id uuid, p_workspace_id uuid, p_name text, p_parent_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (select 1 from organization_members where org_id = p_org_id and user_id = p_user_id)
  then raise exception 'Acesso negado'; end if;
  insert into documents (org_id, workspace_id, parent_id, title, content, visibility, created_by, is_folder)
  values (p_org_id, p_workspace_id, p_parent_id,
          coalesce(nullif(trim(p_name), ''), 'Nova pasta'),
          '{"type":"doc","content":[]}'::jsonb, 'org', p_user_id, true)
  returning id into v_id;
  return v_id;
end; $$;

create or replace function move_document(p_user_id uuid, p_doc_id uuid, p_parent_id uuid, p_workspace_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_user_manage_doc(p_user_id, p_doc_id) then raise exception 'Acesso negado'; end if;

  -- Anti-ciclo: o destino não pode ser o próprio item nem um descendente dele.
  if p_parent_id is not null then
    if p_parent_id = p_doc_id then raise exception 'Não é possível mover para dentro de si mesma'; end if;
    if exists (
      with recursive sub as (
        select id from documents where id = p_doc_id
        union all
        select d.id from documents d join sub on d.parent_id = sub.id
      ) select 1 from sub where id = p_parent_id
    ) then raise exception 'Não é possível mover uma pasta para dentro dela mesma'; end if;
  end if;

  update documents set parent_id = p_parent_id, workspace_id = p_workspace_id where id = p_doc_id;
end; $$;

grant execute on function create_folder(uuid, uuid, uuid, text, uuid) to anon, authenticated;
grant execute on function move_document(uuid, uuid, uuid, uuid)       to anon, authenticated;

notify pgrst, 'reload schema';
