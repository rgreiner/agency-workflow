-- ── INVITE LINKS ─────────────────────────────────────────────────────────────

CREATE TABLE org_invite_links (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token       uuid NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
  role        member_role NOT NULL DEFAULT 'member',
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES profiles(id),
  use_count   int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE org_invite_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can read invite links" ON org_invite_links
  FOR SELECT USING (is_org_member(org_id));

CREATE POLICY "Owner/admin can manage invite links" ON org_invite_links
  FOR ALL USING (
    (SELECT role FROM organization_members WHERE org_id = org_invite_links.org_id AND user_id = auth.uid()) IN ('owner', 'admin')
  );

-- ── HELPER: is_org_member (avoids RLS recursion) ──────────────────────────────

CREATE OR REPLACE FUNCTION is_org_member(p_org_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE org_id = p_org_id AND user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION is_org_member(uuid) TO anon, authenticated;

-- ── FIX organization_members RLS: separate read vs write policies ──────────────

DROP POLICY IF EXISTS "Owner/admin can manage members" ON organization_members;

CREATE POLICY "Org members can read members" ON organization_members
  FOR SELECT USING (is_org_member(org_id));

CREATE POLICY "Owner/admin can insert members" ON organization_members
  FOR INSERT WITH CHECK (
    (SELECT role FROM organization_members WHERE org_id = organization_members.org_id AND user_id = auth.uid()) IN ('owner', 'admin')
  );

CREATE POLICY "Owner/admin can update members" ON organization_members
  FOR UPDATE USING (
    (SELECT role FROM organization_members WHERE org_id = organization_members.org_id AND user_id = auth.uid()) IN ('owner', 'admin')
  );

CREATE POLICY "Owner/admin can delete members" ON organization_members
  FOR DELETE USING (
    (SELECT role FROM organization_members WHERE org_id = organization_members.org_id AND user_id = auth.uid()) IN ('owner', 'admin')
  );

-- ── RPC: upsert_invite_link ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION upsert_invite_link(
  p_user_id uuid,
  p_org_id  uuid,
  p_role    member_role
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller_role member_role;
  v_token       uuid;
BEGIN
  SELECT role INTO v_caller_role
  FROM organization_members
  WHERE org_id = p_org_id AND user_id = p_user_id;

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Permissão negada: apenas owner/admin podem gerar links de convite';
  END IF;

  -- Deactivate existing active links for same org+role
  UPDATE org_invite_links
  SET is_active = false
  WHERE org_id = p_org_id AND role = p_role AND is_active = true;

  -- Insert new link and return the token
  INSERT INTO org_invite_links (org_id, role, created_by)
  VALUES (p_org_id, p_role, p_user_id)
  RETURNING token INTO v_token;

  RETURN v_token;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_invite_link(uuid, uuid, member_role) TO anon, authenticated;

-- ── RPC: deactivate_invite_link ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION deactivate_invite_link(
  p_user_id uuid,
  p_org_id  uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller_role member_role;
BEGIN
  SELECT role INTO v_caller_role
  FROM organization_members
  WHERE org_id = p_org_id AND user_id = p_user_id;

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Permissão negada: apenas owner/admin podem desativar links';
  END IF;

  UPDATE org_invite_links
  SET is_active = false
  WHERE org_id = p_org_id AND is_active = true;
END;
$$;

GRANT EXECUTE ON FUNCTION deactivate_invite_link(uuid, uuid) TO anon, authenticated;

-- ── RPC: accept_invite_link ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION accept_invite_link(
  p_user_id uuid,
  p_token   uuid
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_link    org_invite_links%ROWTYPE;
  v_slug    text;
  v_exists  boolean;
BEGIN
  -- Fetch the link
  SELECT * INTO v_link
  FROM org_invite_links
  WHERE token = p_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Link de convite não encontrado';
  END IF;

  IF NOT v_link.is_active THEN
    RAISE EXCEPTION 'Link de convite inativo ou expirado';
  END IF;

  -- Get org slug
  SELECT slug INTO v_slug FROM organizations WHERE id = v_link.org_id;

  -- Check if user is already a member (idempotent)
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE org_id = v_link.org_id AND user_id = p_user_id
  ) INTO v_exists;

  IF v_exists THEN
    RETURN v_slug;
  END IF;

  -- Add the user as a member
  INSERT INTO organization_members (org_id, user_id, role, invited_by)
  VALUES (v_link.org_id, p_user_id, v_link.role, v_link.created_by);

  -- Increment use count
  UPDATE org_invite_links
  SET use_count = use_count + 1
  WHERE id = v_link.id;

  RETURN v_slug;
END;
$$;

GRANT EXECUTE ON FUNCTION accept_invite_link(uuid, uuid) TO anon, authenticated;
