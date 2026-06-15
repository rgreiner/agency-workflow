-- ════════════════════════════════════════════════════════════════════
-- 020 — RPCs que o app chama mas NUNCA foram versionadas no repo
-- (existiam só no Supabase original). Reconstruídas a partir do contrato
-- do app + schema + funções gêmeas existentes (create/update padrão).
-- Faltavam: create_org_for_user, create_workspace, create_campaign,
-- add_activity_comment, update_activity_status, get_invite_info.
-- ════════════════════════════════════════════════════════════════════

-- ── create_org_for_user (onboarding) ─────────────────────────────────
CREATE OR REPLACE FUNCTION create_org_for_user(
  p_user_id uuid,
  p_name    text,
  p_slug    text,
  p_type    text DEFAULT NULL,
  p_size    text DEFAULT NULL,
  p_segment text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_org_id uuid;
BEGIN
  INSERT INTO organizations (name, slug, company_type, company_size, segment)
  VALUES (p_name, p_slug, p_type, p_size, p_segment)
  RETURNING id INTO v_org_id;

  INSERT INTO organization_members (org_id, user_id, role)
  VALUES (v_org_id, p_user_id, 'owner');

  PERFORM seed_default_positions(v_org_id);

  RETURN v_org_id;
END;
$$;

-- ── create_workspace ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_workspace(
  p_user_id     uuid,
  p_org_id      uuid,
  p_name        text,
  p_description text,
  p_color       text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.org_id = p_org_id AND om.user_id = p_user_id
      AND om.role IN ('owner','admin','manager')
  ) THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  INSERT INTO workspaces (org_id, name, description, color, created_by)
  VALUES (p_org_id, p_name, p_description, COALESCE(NULLIF(p_color,''), '#6366f1'), p_user_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ── create_campaign ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_campaign(
  p_user_id      uuid,
  p_workspace_id uuid,
  p_name         text,
  p_description  text,
  p_start_date   date,
  p_end_date     date
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM workspaces w
    JOIN organization_members om ON om.org_id = w.org_id
    WHERE w.id = p_workspace_id AND om.user_id = p_user_id
      AND om.role IN ('owner','admin','manager')
  ) THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  INSERT INTO campaigns (workspace_id, name, description, start_date, end_date, created_by)
  VALUES (p_workspace_id, p_name, p_description, p_start_date, p_end_date, p_user_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ── add_activity_comment (qualquer membro da org) ────────────────────
CREATE OR REPLACE FUNCTION add_activity_comment(
  p_user_id     uuid,
  p_activity_id uuid,
  p_content     text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM activities a
    JOIN campaigns c ON c.id = a.campaign_id
    JOIN workspaces w ON w.id = c.workspace_id
    JOIN organization_members om ON om.org_id = w.org_id
    WHERE a.id = p_activity_id AND om.user_id = p_user_id
  ) THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  INSERT INTO activity_comments (activity_id, user_id, content)
  VALUES (p_activity_id, p_user_id, p_content)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ── update_activity_status (+ histórico) ─────────────────────────────
CREATE OR REPLACE FUNCTION update_activity_status(
  p_user_id     uuid,
  p_activity_id uuid,
  p_new_status  activity_status,
  p_comment     text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_old activity_status;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM activities a
    JOIN campaigns c ON c.id = a.campaign_id
    JOIN workspaces w ON w.id = c.workspace_id
    JOIN organization_members om ON om.org_id = w.org_id
    WHERE a.id = p_activity_id AND om.user_id = p_user_id
  ) THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  SELECT status INTO v_old FROM activities WHERE id = p_activity_id;

  UPDATE activities SET status = p_new_status, updated_at = now()
  WHERE id = p_activity_id;

  INSERT INTO activity_history (activity_id, from_status, to_status, changed_by, comment)
  VALUES (p_activity_id, v_old, p_new_status, p_user_id, NULLIF(p_comment, ''));
END;
$$;

-- ── get_invite_info (visitante, bypassa RLS) ─────────────────────────
CREATE OR REPLACE FUNCTION get_invite_info(p_token uuid)
RETURNS TABLE (is_active boolean, org_name text, org_slug text, role member_role)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT l.is_active, o.name, o.slug, l.role
  FROM org_invite_links l
  JOIN organizations o ON o.id = l.org_id
  WHERE l.token = p_token;
$$;

-- ── grants ───────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION create_org_for_user(uuid,text,text,text,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION create_workspace(uuid,uuid,text,text,text)         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION create_campaign(uuid,uuid,text,text,date,date)     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION add_activity_comment(uuid,uuid,text)               TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_activity_status(uuid,uuid,activity_status,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_invite_info(uuid)                              TO anon, authenticated;
