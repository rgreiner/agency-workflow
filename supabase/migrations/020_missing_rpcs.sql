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
