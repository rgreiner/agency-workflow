-- Documentos: escritas via RPC security definer (p_user_id explícito), igual
-- ao resto do app. O acesso direto (insert/update) batia em RLS/privilégio no
-- self-hosted, fazendo "criar documento" falhar silenciosamente.
-- Também concede GRANT de tabela (leitura) — mesmo caso de notifications (024).

-- Pode gerenciar (editar/excluir): criador ou owner/admin da org.
create or replace function can_user_manage_doc(p_user_id uuid, p_doc_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from documents d where d.id = p_doc_id and (
      d.created_by = p_user_id
      or exists (
        select 1 from organization_members m
        where m.org_id = d.org_id and m.user_id = p_user_id and m.role in ('owner','admin')
      )
    )
  );
$$;

create or replace function create_document(p_user_id uuid, p_org_id uuid, p_workspace_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (select 1 from organization_members where org_id = p_org_id and user_id = p_user_id)
  then raise exception 'Acesso negado'; end if;
  insert into documents (org_id, workspace_id, title, content, visibility, created_by)
  values (p_org_id, p_workspace_id, 'Sem título', '{"type":"doc","content":[]}'::jsonb, 'org', p_user_id)
  returning id into v_id;
  return v_id;
end; $$;

create or replace function update_document_content(p_user_id uuid, p_doc_id uuid, p_content jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_user_manage_doc(p_user_id, p_doc_id) then raise exception 'Acesso negado'; end if;
  update documents set content = p_content where id = p_doc_id;
end; $$;

create or replace function update_document_title(p_user_id uuid, p_doc_id uuid, p_title text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_user_manage_doc(p_user_id, p_doc_id) then raise exception 'Acesso negado'; end if;
  update documents set title = coalesce(nullif(trim(p_title), ''), 'Sem título') where id = p_doc_id;
end; $$;

create or replace function set_document_visibility(p_user_id uuid, p_doc_id uuid, p_visibility text, p_member_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_user_manage_doc(p_user_id, p_doc_id) then raise exception 'Acesso negado'; end if;
  update documents set visibility = p_visibility where id = p_doc_id;
  delete from document_members where document_id = p_doc_id;
  if p_visibility = 'custom' and p_member_ids is not null and array_length(p_member_ids, 1) > 0 then
    insert into document_members (document_id, user_id)
    select p_doc_id, unnest(p_member_ids);
  end if;
end; $$;

create or replace function delete_document(p_user_id uuid, p_doc_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_user_manage_doc(p_user_id, p_doc_id) then raise exception 'Acesso negado'; end if;
  delete from documents where id = p_doc_id;
end; $$;

grant execute on function can_user_manage_doc(uuid, uuid)               to anon, authenticated;
grant execute on function create_document(uuid, uuid, uuid)            to anon, authenticated;
grant execute on function update_document_content(uuid, uuid, jsonb)   to anon, authenticated;
grant execute on function update_document_title(uuid, uuid, text)      to anon, authenticated;
grant execute on function set_document_visibility(uuid, uuid, text, uuid[]) to anon, authenticated;
grant execute on function delete_document(uuid, uuid)                  to anon, authenticated;

-- Leitura direta (lista + editor) — RLS continua gateando cada linha.
grant select, insert, update, delete on documents        to anon, authenticated;
grant select, insert, update, delete on document_members to anon, authenticated;

notify pgrst, 'reload schema';
