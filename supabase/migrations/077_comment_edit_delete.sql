-- 077_comment_edit_delete.sql
-- Editar/apagar comentário. Autor edita e apaga o próprio; o OWNER da empresa apaga
-- o de qualquer um. Idempotente.

-- Editar (só o autor).
create or replace function update_comment(p_user_id uuid, p_comment_id uuid, p_content text)
returns void language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select * into c from activity_comments where id = p_comment_id;
  if not found then raise exception 'Comentário não encontrado'; end if;
  if c.user_id <> p_user_id then raise exception 'Acesso negado'; end if;
  if nullif(btrim(p_content), '') is null then raise exception 'Comentário vazio'; end if;
  update activity_comments set content = p_content, updated_at = now() where id = p_comment_id;
end; $$;

-- Apagar (autor OU owner da empresa).
create or replace function delete_comment(p_user_id uuid, p_comment_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c record; v_org uuid; v_role text;
begin
  select * into c from activity_comments where id = p_comment_id;
  if not found then return; end if;

  select w.org_id into v_org
    from activities a
    join campaigns ca on ca.id = a.campaign_id
    join workspaces w on w.id = ca.workspace_id
    where a.id = c.activity_id;
  select role into v_role from organization_members where org_id = v_org and user_id = p_user_id;

  if c.user_id = p_user_id or v_role = 'owner' then
    delete from activity_comment_reactions where comment_id = p_comment_id;
    delete from activity_comments where id = p_comment_id;
  else
    raise exception 'Acesso negado';
  end if;
end; $$;

grant execute on function update_comment(uuid,uuid,text) to anon, authenticated;
grant execute on function delete_comment(uuid,uuid) to anon, authenticated;

notify pgrst, 'reload schema';
