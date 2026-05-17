-- ── update_workspace ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_workspace(
  p_user_id      uuid,
  p_workspace_id uuid,
  p_name         text,
  p_description  text,
  p_color        text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM workspaces w
    JOIN organization_members om ON om.org_id = w.org_id
    WHERE w.id = p_workspace_id AND om.user_id = p_user_id
      AND om.role IN ('owner','admin','manager')
  ) THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  UPDATE workspaces SET
    name        = p_name,
    description = p_description,
    color       = p_color,
    updated_at  = now()
  WHERE id = p_workspace_id;
END;
$$;

-- ── delete_workspace ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION delete_workspace(
  p_user_id      uuid,
  p_workspace_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM workspaces w
    JOIN organization_members om ON om.org_id = w.org_id
    WHERE w.id = p_workspace_id AND om.user_id = p_user_id
      AND om.role IN ('owner','admin')
  ) THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  DELETE FROM workspaces WHERE id = p_workspace_id;
END;
$$;

-- ── update_campaign ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_campaign(
  p_user_id     uuid,
  p_campaign_id uuid,
  p_name        text,
  p_description text,
  p_start_date  date,
  p_end_date    date
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM campaigns c
    JOIN workspaces w ON w.id = c.workspace_id
    JOIN organization_members om ON om.org_id = w.org_id
    WHERE c.id = p_campaign_id AND om.user_id = p_user_id
      AND om.role IN ('owner','admin','manager')
  ) THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  UPDATE campaigns SET
    name        = p_name,
    description = p_description,
    start_date  = p_start_date,
    end_date    = p_end_date,
    updated_at  = now()
  WHERE id = p_campaign_id;
END;
$$;

-- ── delete_campaign ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION delete_campaign(
  p_user_id     uuid,
  p_campaign_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM campaigns c
    JOIN workspaces w ON w.id = c.workspace_id
    JOIN organization_members om ON om.org_id = w.org_id
    WHERE c.id = p_campaign_id AND om.user_id = p_user_id
      AND om.role IN ('owner','admin','manager')
  ) THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  DELETE FROM campaigns WHERE id = p_campaign_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_workspace(uuid,uuid,text,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION delete_workspace(uuid,uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_campaign(uuid,uuid,text,text,date,date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION delete_campaign(uuid,uuid) TO anon, authenticated;
