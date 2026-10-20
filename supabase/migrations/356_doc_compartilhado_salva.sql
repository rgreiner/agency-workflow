-- Documento compartilhado: quem recebeu consegue SALVAR (conteúdo e título).
--
-- 20/10/2026: a Erika não salvava "Senhas - ADM", que o Rafael criou e compartilhou
-- com ela ("Erro ao salvar"). update_document_content/_title checavam
-- can_user_manage_doc — só criador ou owner/admin —, ignorando o compartilhamento
-- e a visibilidade "organização". A régua certa já existia: can_manage_doc
-- (mig. 276), que a própria policy de UPDATE da tabela usa.
--
-- Só EDITAR muda. Excluir, mover, arquivar, trocar a visibilidade/compartilhamento
-- seguem em can_user_manage_doc: quem recebeu edita, mas não apaga nem repassa.

create or replace function update_document_content(p_user_id uuid, p_doc_id uuid, p_content jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not can_manage_doc(p_doc_id) then raise exception 'Acesso negado'; end if;
  update documents set content = p_content where id = p_doc_id;
end $$;

create or replace function update_document_title(p_user_id uuid, p_doc_id uuid, p_title text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not can_manage_doc(p_doc_id) then raise exception 'Acesso negado'; end if;
  update documents set title = coalesce(nullif(trim(p_title), ''), 'Sem título') where id = p_doc_id;
end $$;

revoke execute on function update_document_content(uuid, uuid, jsonb) from public, anon;
revoke execute on function update_document_title(uuid, uuid, text) from public, anon;
grant execute on function update_document_content(uuid, uuid, jsonb) to authenticated;
grant execute on function update_document_title(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
