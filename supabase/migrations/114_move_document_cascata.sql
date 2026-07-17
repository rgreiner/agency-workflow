-- 114_move_document_cascata.sql
-- move_document só trocava o workspace_id do PRÓPRIO item:
--   update documents set parent_id = ..., workspace_id = ... where id = p_doc_id;
-- Mover a pasta "Ópera" pro cliente Ópera deixava os documentos DENTRO dela com
-- workspace_id = null (= Organização). Na tela ninguém percebe — a árvore monta os
-- filhos por parent_id e só os raízes por workspace_id — mas no banco o subtree fica
-- pertencendo a outro dono. Qualquer coisa que filtre documento por cliente (relatório,
-- briefing, permissão futura) leria errado, e sem sintoma visível.
--
-- Agora o cliente é do SUBTREE: quem está dentro da pasta pertence ao cliente da pasta.
-- Idempotente; anti-ciclo e gate de permissão seguem iguais à 079.

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

  -- Cascata: todo o conteúdo da pasta acompanha o cliente.
  with recursive sub as (
    select id from documents where parent_id = p_doc_id
    union all
    select d.id from documents d join sub on d.parent_id = sub.id
  )
  update documents set workspace_id = p_workspace_id, updated_at = now()
  where id in (select id from sub) and workspace_id is distinct from p_workspace_id;
end; $$;

grant execute on function move_document(uuid, uuid, uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
