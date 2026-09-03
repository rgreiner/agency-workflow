-- 276_docs_edicao_do_time.sql
-- "Pessoal que usa Windows e Chrome não está conseguindo editar" (03/09).
--
-- Não era o navegador: a coincidência é que o Rafael (único `owner`) usa Mac e
-- o time usa Windows. A régua de edição — igual na tela e na policy — era
-- "criador OU owner/admin". Medido em prod: 44 documentos, TODOS com
-- visibilidade 'org', 27 criados pelo Rafael; a org tem 1 owner, 3 managers,
-- 5 members e NENHUM admin. Ou seja: o time abria os 27 documentos dele em
-- modo leitura, sem barra de ferramentas e sem cursor — e concluía que o
-- Chrome estava quebrado.
--
-- Régua nova (decisão do Rafael): documento com visibilidade da ORGANIZAÇÃO é
-- colaborativo — qualquer membro ativo edita. Documento privado continua do
-- criador, do owner/admin e de quem foi compartilhado explicitamente.
--
-- ⭐ `document_members` finalmente CONTA: a tabela existia, o modal de
-- compartilhar gravava nela e nada a lia para permissão — compartilhar não
-- dava acesso nenhum.
-- Idempotente.

create or replace function can_manage_doc(p_doc_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from documents d
    where d.id = p_doc_id
      and (
        d.created_by = auth.uid()
        -- Visibilidade da organização = documento do time: quem é membro
        -- ATIVO edita (arquivado não — mesma régua de is_org_member).
        or (coalesce(d.visibility, 'private') = 'org' and exists (
              select 1 from organization_members m
               where m.org_id = d.org_id and m.user_id = auth.uid()
                 and coalesce(m.arquivado, false) = false))
        -- Compartilhado explicitamente (o modal Compartilhar).
        or exists (
              select 1 from document_members dm
               where dm.document_id = d.id and dm.user_id = auth.uid())
        or exists (
              select 1 from organization_members m
               where m.org_id = d.org_id and m.user_id = auth.uid()
                 and coalesce(m.arquivado, false) = false
                 and m.role in ('owner', 'admin'))
      )
  );
$$;

notify pgrst, 'reload schema';
