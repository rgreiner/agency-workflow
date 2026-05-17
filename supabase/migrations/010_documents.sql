-- ── DOCUMENTS ─────────────────────────────────────────────────────────────────

CREATE TABLE documents (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_id    uuid REFERENCES documents(id) ON DELETE CASCADE,
  title        text NOT NULL DEFAULT 'Sem título',
  content      jsonb NOT NULL DEFAULT '{"type":"doc","content":[]}',
  visibility   text NOT NULL DEFAULT 'org' CHECK (visibility IN ('org', 'custom')),
  created_by   uuid NOT NULL REFERENCES profiles(id),
  sort_order   int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE document_members (
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (document_id, user_id)
);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_members ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_documents_org      ON documents(org_id);
CREATE INDEX idx_documents_workspace ON documents(workspace_id);
CREATE INDEX idx_documents_parent   ON documents(parent_id);
CREATE INDEX idx_documents_created  ON documents(created_by);

-- ── SECURITY DEFINER HELPERS (break RLS recursion) ────────────────────────────

-- Returns true if auth.uid() can read this document
CREATE OR REPLACE FUNCTION has_doc_access(p_doc_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = p_doc_id
      AND is_org_member(d.org_id)
      AND (
        d.visibility = 'org'
        OR d.created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM document_members dm
          WHERE dm.document_id = d.id AND dm.user_id = auth.uid()
        )
      )
  );
$$;

-- Returns true if auth.uid() is a member of this document's org
CREATE OR REPLACE FUNCTION is_doc_org_member(p_doc_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = p_doc_id AND is_org_member(d.org_id)
  );
$$;

-- Returns true if auth.uid() can update/delete this document
CREATE OR REPLACE FUNCTION can_manage_doc(p_doc_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = p_doc_id AND (
      d.created_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM organization_members
        WHERE org_id = d.org_id
          AND user_id = auth.uid()
          AND role IN ('owner', 'admin')
      )
    )
  );
$$;

GRANT EXECUTE ON FUNCTION has_doc_access(uuid)    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION is_doc_org_member(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION can_manage_doc(uuid)    TO anon, authenticated;

-- ── RLS POLICIES ──────────────────────────────────────────────────────────────

CREATE POLICY "Members can read accessible documents" ON documents
  FOR SELECT USING (has_doc_access(id));

CREATE POLICY "Members can create documents" ON documents
  FOR INSERT WITH CHECK (is_org_member(org_id) AND created_by = auth.uid());

CREATE POLICY "Creator and admin can update documents" ON documents
  FOR UPDATE USING (can_manage_doc(id));

CREATE POLICY "Creator and admin can delete documents" ON documents
  FOR DELETE USING (can_manage_doc(id));

CREATE POLICY "Org members can read document shares" ON document_members
  FOR SELECT USING (is_doc_org_member(document_id));

CREATE POLICY "Creator and admin can manage shares" ON document_members
  FOR ALL USING (can_manage_doc(document_id));
