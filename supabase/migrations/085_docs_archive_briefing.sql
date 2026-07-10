-- 085_docs_archive_briefing.sql
-- Docs: (1) arquivar documentos/pastas (recursivo) + (2) marcar um doc como
-- BRIEFING de UM cliente (workspace) OU UMA campanha — único por cliente/campanha,
-- aberto a toda a org (visibility='org'). Idempotente.

-- ── Colunas ──────────────────────────────────────────────────────────────────
alter table documents add column if not exists archived boolean not null default false;
alter table documents add column if not exists briefing_workspace_id uuid references workspaces(id) on delete set null;
alter table documents add column if not exists briefing_campaign_id  uuid references campaigns(id)  on delete set null;

-- No máximo um alvo de briefing por doc (cliente OU campanha, nunca os dois).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'documents_briefing_one_target') then
    alter table documents add constraint documents_briefing_one_target
      check (briefing_workspace_id is null or briefing_campaign_id is null);
  end if;
end $$;

-- Unicidade: 1 briefing por cliente e 1 por campanha.
create unique index if not exists uq_doc_briefing_ws   on documents(briefing_workspace_id) where briefing_workspace_id is not null;
create unique index if not exists uq_doc_briefing_camp on documents(briefing_campaign_id)  where briefing_campaign_id  is not null;

-- ── Arquivar (recursivo: pasta arquiva/reativa todo o conteúdo junto) ─────────
create or replace function set_document_archived(p_user_id uuid, p_doc_id uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_user_manage_doc(p_user_id, p_doc_id) then raise exception 'Acesso negado'; end if;
  with recursive sub as (
    select id from documents where id = p_doc_id
    union all
    select d.id from documents d join sub s on d.parent_id = s.id
  )
  update documents set archived = p_archived, updated_at = now() where id in (select id from sub);
end; $$;
grant execute on function set_document_archived(uuid, uuid, boolean) to anon, authenticated;

-- ── Briefing (define/limpa o vínculo; garante unicidade e "aberto a todos") ───
-- p_kind: 'workspace' | 'campaign' | 'none'. Ao vincular, também associa o doc ao
-- cliente (workspace_id) p/ agrupar na estrutura e força visibility='org'.
create or replace function set_document_briefing(p_user_id uuid, p_doc_id uuid, p_kind text, p_target_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_ws uuid; v_conflict text;
begin
  if not can_user_manage_doc(p_user_id, p_doc_id) then raise exception 'Acesso negado'; end if;
  select org_id into v_org from documents where id = p_doc_id;
  if v_org is null then raise exception 'Documento não encontrado'; end if;

  if p_kind = 'none' or p_target_id is null then
    update documents set briefing_workspace_id = null, briefing_campaign_id = null, updated_at = now() where id = p_doc_id;

  elsif p_kind = 'workspace' then
    if not exists (select 1 from workspaces where id = p_target_id and org_id = v_org) then raise exception 'Cliente inválido'; end if;
    select title into v_conflict from documents where briefing_workspace_id = p_target_id and id <> p_doc_id limit 1;
    if v_conflict is not null then raise exception 'Este cliente já tem um briefing: %', v_conflict; end if;
    update documents set briefing_workspace_id = p_target_id, briefing_campaign_id = null,
      workspace_id = p_target_id, visibility = 'org', updated_at = now() where id = p_doc_id;

  elsif p_kind = 'campaign' then
    select w.id into v_ws from campaigns c join workspaces w on w.id = c.workspace_id where c.id = p_target_id and w.org_id = v_org;
    if v_ws is null then raise exception 'Campanha inválida'; end if;
    select title into v_conflict from documents where briefing_campaign_id = p_target_id and id <> p_doc_id limit 1;
    if v_conflict is not null then raise exception 'Esta campanha já tem um briefing: %', v_conflict; end if;
    update documents set briefing_campaign_id = p_target_id, briefing_workspace_id = null,
      workspace_id = v_ws, visibility = 'org', updated_at = now() where id = p_doc_id;

  else
    raise exception 'Tipo de briefing inválido';
  end if;
end; $$;
grant execute on function set_document_briefing(uuid, uuid, text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
