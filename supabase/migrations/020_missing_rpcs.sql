-- ════════════════════════════════════════════════════════════════════
-- 020 — RPCs + policies que faltavam no repo (existiam só no Supabase
-- original). Versões AUTORITATIVAS extraídas do DUMP DA PRODUÇÃO
-- (pg_get_functiondef) + reconciliação de policies. Substitui a
-- reconstrução manual anterior — agora bate 100% com a produção.
-- Faltavam as funções: create_org_for_user, create_workspace,
-- create_campaign, add_activity_comment, update_activity_status,
-- get_invite_info; e 3 policies (+ alinhar a de org_invite_links).
-- ════════════════════════════════════════════════════════════════════

-- drop das minhas reconstruções (tinham defaults) antes de aplicar as da produção
drop function if exists create_org_for_user(uuid,text,text,text,text,text);
drop function if exists create_workspace(uuid,uuid,text,text,text);
drop function if exists create_campaign(uuid,uuid,text,text,date,date);
drop function if exists add_activity_comment(uuid,uuid,text);
drop function if exists update_activity_status(uuid,uuid,activity_status,text);
drop function if exists get_invite_info(uuid);
CREATE OR REPLACE FUNCTION public.add_activity_comment(p_user_id uuid, p_activity_id uuid, p_content text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if not exists (
    select 1 from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    join organization_members m on m.org_id = w.org_id
    where a.id = p_activity_id and m.user_id = p_user_id
  ) then
    raise exception 'Acesso negado';
  end if;

  insert into activity_comments (activity_id, user_id, content)
  values (p_activity_id, p_user_id, p_content)
  returning id into v_id;

  return v_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.create_campaign(p_user_id uuid, p_workspace_id uuid, p_name text, p_description text, p_start_date date, p_end_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if not exists (
    select 1 from workspaces w
    join organization_members m on m.org_id = w.org_id
    where w.id = p_workspace_id and m.user_id = p_user_id
  ) then
    raise exception 'Acesso negado';
  end if;
  insert into campaigns (workspace_id, name, description, start_date, end_date, created_by)
  values (p_workspace_id, p_name, nullif(p_description,''), p_start_date, p_end_date, p_user_id)
  returning id into v_id;
  return v_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.create_org_for_user(p_user_id uuid, p_name text, p_slug text, p_type text, p_size text, p_segment text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org_id uuid;
begin
  insert into organizations (name, slug, plan, max_members, company_type, company_size, segment)
  values (p_name, p_slug, 'free', 5, p_type, p_size, p_segment)
  returning id into v_org_id;

  insert into organization_members (org_id, user_id, role)
  values (v_org_id, p_user_id, 'owner');

  return v_org_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.create_workspace(p_user_id uuid, p_org_id uuid, p_name text, p_description text, p_color text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if not exists (select 1 from organization_members where org_id = p_org_id and user_id = p_user_id) then
    raise exception 'Acesso negado';
  end if;
  insert into workspaces (org_id, name, description, color, created_by)
  values (p_org_id, p_name, nullif(p_description,''), p_color, p_user_id)
  returning id into v_id;
  return v_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_invite_info(p_token uuid)
 RETURNS TABLE(token uuid, is_active boolean, role member_role, org_name text, org_slug text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    il.token,
    il.is_active,
    il.role,
    o.name  AS org_name,
    o.slug  AS org_slug
  FROM org_invite_links il
  JOIN organizations o ON o.id = il.org_id
  WHERE il.token = p_token;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.update_activity_status(p_user_id uuid, p_activity_id uuid, p_new_status activity_status, p_comment text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_old_status activity_status;
begin
  select status into v_old_status from activities where id = p_activity_id;

  if not exists (
    select 1 from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    join organization_members m on m.org_id = w.org_id
    where a.id = p_activity_id and m.user_id = p_user_id
  ) then
    raise exception 'Acesso negado';
  end if;

  update activities set status = p_new_status, updated_at = now() where id = p_activity_id;

  insert into activity_history (activity_id, from_status, to_status, changed_by, comment)
  values (p_activity_id, v_old_status, p_new_status, p_user_id, nullif(p_comment,''));
end;
$function$
;

-- ── policies alinhadas com a produção ──
drop policy if exists "Org members can read invite links" on public.org_invite_links;
drop policy if exists "Anyone can read active invite links" on public.org_invite_links;
create policy "Anyone can read active invite links" on public.org_invite_links for select using ((is_active = true));
drop policy if exists "Authenticated users can create org" on public.organizations;
create policy "Authenticated users can create org" on public.organizations for insert with check ((auth.uid() is not null));
drop policy if exists "Users can insert themselves as member" on public.organization_members;
create policy "Users can insert themselves as member" on public.organization_members for insert with check ((user_id = auth.uid()));
grant execute on function create_org_for_user(uuid,text,text,text,text,text), create_workspace(uuid,uuid,text,text,text), create_campaign(uuid,uuid,text,text,date,date), add_activity_comment(uuid,uuid,text), update_activity_status(uuid,uuid,activity_status,text), get_invite_info(uuid) to anon, authenticated;

-- ── reconciliação adicional: funções cujo corpo divergia do repo + tipo de coluna ──
alter table activities alter column start_date type date using start_date::date;
CREATE OR REPLACE FUNCTION public.accept_invite_link(p_user_id uuid, p_token uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_link org_invite_links%ROWTYPE; v_slug text; v_exists boolean;
BEGIN
  SELECT * INTO v_link FROM org_invite_links WHERE token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'Link não encontrado'; END IF;
  IF NOT v_link.is_active THEN RAISE EXCEPTION 'Link inativo'; END IF;
  SELECT slug INTO v_slug FROM organizations WHERE id = v_link.org_id;
  SELECT EXISTS (SELECT 1 FROM organization_members WHERE org_id = v_link.org_id AND user_id = p_user_id) INTO v_exists;
  IF v_exists THEN RETURN v_slug; END IF;
  INSERT INTO organization_members (org_id, user_id, role, invited_by) VALUES (v_link.org_id, p_user_id, v_link.role, v_link.created_by);
  UPDATE org_invite_links SET use_count = use_count + 1 WHERE id = v_link.id;
  RETURN v_slug;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.can_manage_doc(p_doc_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM documents
    WHERE id = p_doc_id
      AND (
        created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM organization_members
          WHERE org_id = (SELECT org_id FROM documents WHERE id = p_doc_id)
            AND user_id = auth.uid()
            AND role IN ('owner', 'admin')
        )
      )
  );
$function$
;
CREATE OR REPLACE FUNCTION public.create_activity(p_user_id uuid, p_campaign_id uuid, p_title text, p_description text, p_status activity_status, p_priority activity_priority, p_complexity activity_complexity, p_due_date timestamp with time zone, p_estimated_hours numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if not exists (
    select 1 from campaigns c
    join workspaces w on w.id = c.workspace_id
    join organization_members m on m.org_id = w.org_id
    where c.id = p_campaign_id and m.user_id = p_user_id
  ) then
    raise exception 'Acesso negado';
  end if;

  insert into activities (campaign_id, title, description, status, priority, complexity, due_date, estimated_hours, created_by)
  values (p_campaign_id, p_title, nullif(p_description,''), p_status, p_priority, p_complexity, p_due_date, p_estimated_hours, p_user_id)
  returning id into v_id;

  -- Registra no histórico
  insert into activity_history (activity_id, from_status, to_status, changed_by)
  values (v_id, null, p_status, p_user_id);

  return v_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.create_activity(p_user_id uuid, p_campaign_id uuid, p_title text, p_description text DEFAULT ''::text, p_status text DEFAULT 'briefing'::text, p_priority text DEFAULT 'medium'::text, p_complexity text DEFAULT 'medium'::text, p_due_date date DEFAULT NULL::date, p_estimated_hours numeric DEFAULT NULL::numeric, p_start_date date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  -- Verifica se o usuário tem acesso à campanha
  IF NOT EXISTS (
    SELECT 1 FROM campaigns c
    JOIN workspaces w ON w.id = c.workspace_id
    JOIN organization_members m ON m.org_id = w.org_id
    WHERE c.id = p_campaign_id AND m.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  INSERT INTO activities (
    campaign_id, title, description, status,
    priority, complexity, due_date, estimated_hours,
    start_date, created_by
  ) VALUES (
    p_campaign_id, p_title, p_description, p_status::activity_status,
    p_priority::activity_priority, p_complexity::activity_complexity,
    p_due_date, p_estimated_hours, p_start_date, p_user_id
  )
  RETURNING id INTO v_id;

  -- Registra no histórico
  INSERT INTO activity_history (activity_id, changed_by, to_status)
  VALUES (v_id, p_user_id, p_status::activity_status);

  RETURN v_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.deactivate_invite_link(p_user_id uuid, p_org_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_caller_role member_role;
BEGIN
  SELECT role INTO v_caller_role FROM organization_members WHERE org_id = p_org_id AND user_id = p_user_id;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Permissão negada'; END IF;
  UPDATE org_invite_links SET is_active = false WHERE org_id = p_org_id AND is_active = true;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.has_doc_access(p_doc_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM documents
    WHERE id = p_doc_id
      AND is_org_member(org_id)
      AND (
        visibility = 'org'
        OR created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM document_members
          WHERE document_id = p_doc_id AND user_id = auth.uid()
        )
      )
  );
$function$
;
CREATE OR REPLACE FUNCTION public.is_doc_org_member(p_doc_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM documents
    WHERE id = p_doc_id AND is_org_member(org_id)
  );
$function$
;
CREATE OR REPLACE FUNCTION public.is_org_member(org uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  select exists (
    select 1 from organization_members
    where org_id = org and user_id = auth.uid()
  );
$function$
;
CREATE OR REPLACE FUNCTION public.upsert_invite_link(p_user_id uuid, p_org_id uuid, p_role member_role)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_caller_role member_role; v_token uuid;
BEGIN
  SELECT role INTO v_caller_role FROM organization_members WHERE org_id = p_org_id AND user_id = p_user_id;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Permissão negada'; END IF;
  UPDATE org_invite_links SET is_active = false WHERE org_id = p_org_id AND role = p_role AND is_active = true;
  INSERT INTO org_invite_links (org_id, role, created_by) VALUES (p_org_id, p_role, p_user_id) RETURNING token INTO v_token;
  RETURN v_token;
END;
$function$
;
grant execute on all functions in schema public to anon, authenticated;
