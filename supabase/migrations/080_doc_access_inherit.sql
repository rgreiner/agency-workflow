-- 080_doc_access_inherit.sql
-- Acesso de documento HERDA da pasta-raiz. O acesso (visibility + membros) é
-- definido no item-RAIZ (pasta de topo ou doc solto); tudo aninhado dentro segue.
-- has_doc_access passa a subir até a raiz (parent_id null) e checar o acesso dela.
-- Anti-ciclo garantido pela 079 (move_document), então a subida sempre termina.
-- Idempotente.

-- Raiz de um documento: sobe pelo parent_id até o topo.
create or replace function doc_root(p_doc_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  with recursive up as (
    select id, parent_id from documents where id = p_doc_id
    union all
    select d.id, d.parent_id from documents d join up on d.id = up.parent_id
  )
  select id from up where parent_id is null limit 1;
$$;

-- Acesso = acesso do item-raiz.
create or replace function has_doc_access(p_doc_id uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from documents root
    where root.id = coalesce(doc_root(p_doc_id), p_doc_id)
      and is_org_member(root.org_id)
      and (
        root.visibility = 'org'
        or root.created_by = auth.uid()
        or exists (
          select 1 from document_members dm
          where dm.document_id = root.id and dm.user_id = auth.uid()
        )
      )
  );
$$;

grant execute on function doc_root(uuid)       to anon, authenticated;
grant execute on function has_doc_access(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
