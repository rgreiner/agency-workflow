-- Org-level customization: logo, accent color, status overrides
CREATE TABLE IF NOT EXISTS org_settings (
  org_id           uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  logo_url         text,
  accent_color     text NOT NULL DEFAULT '#6366f1',
  status_overrides jsonb NOT NULL DEFAULT '[]',
  -- status_overrides: [{value, label, bg, text}]
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE org_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can view org settings"
  ON org_settings FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM organization_members
    WHERE org_id = org_settings.org_id AND user_id = auth.uid()
  ));

-- SECURITY DEFINER: only admins/owners can update
CREATE OR REPLACE FUNCTION upsert_org_settings(
  p_user_id        uuid,
  p_org_id         uuid,
  p_logo_url       text,
  p_accent_color   text,
  p_status_overrides jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role
  FROM organization_members
  WHERE org_id = p_org_id AND user_id = p_user_id;

  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Apenas administradores podem alterar as configurações';
  END IF;

  INSERT INTO org_settings (org_id, logo_url, accent_color, status_overrides, updated_at)
  VALUES (p_org_id, p_logo_url, p_accent_color, p_status_overrides, now())
  ON CONFLICT (org_id) DO UPDATE SET
    logo_url         = EXCLUDED.logo_url,
    accent_color     = EXCLUDED.accent_color,
    status_overrides = EXCLUDED.status_overrides,
    updated_at       = now();
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_org_settings(uuid,uuid,text,text,jsonb) TO anon, authenticated;
