-- ── activity_assignees table ──────────────────────────────────────────────────
-- Cria somente se não existir (pode ter sido criada na migration 004)
CREATE TABLE IF NOT EXISTS activity_assignees (
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES profiles(id)  ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, user_id)
);

ALTER TABLE activity_assignees ENABLE ROW LEVEL SECURITY;

-- Qualquer membro da org pode ver os responsáveis
DROP POLICY IF EXISTS "Org members can read assignees" ON activity_assignees;
CREATE POLICY "Org members can read assignees" ON activity_assignees
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM activities a
      JOIN campaigns  c ON c.id  = a.campaign_id
      JOIN workspaces w ON w.id  = c.workspace_id
      WHERE a.id = activity_assignees.activity_id
        AND is_org_member(w.org_id)
    )
  );

-- Membros da org podem inserir/remover responsáveis
DROP POLICY IF EXISTS "Org members can manage assignees" ON activity_assignees;
CREATE POLICY "Org members can manage assignees" ON activity_assignees
  FOR ALL USING (
    EXISTS (
      SELECT 1
      FROM activities a
      JOIN campaigns  c ON c.id  = a.campaign_id
      JOIN workspaces w ON w.id  = c.workspace_id
      WHERE a.id = activity_assignees.activity_id
        AND is_org_member(w.org_id)
    )
  );

-- ── toggle_activity_assignee RPC ──────────────────────────────────────────────
-- Atribui ou remove um responsável de uma atividade.
-- Retorna TRUE se o usuário ficou atribuído, FALSE se foi removido.
CREATE OR REPLACE FUNCTION toggle_activity_assignee(
  p_user_id     uuid,   -- quem está fazendo a ação
  p_activity_id uuid,
  p_assignee_id uuid    -- quem está sendo atribuído/removido
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_exists boolean;
BEGIN
  -- Descobre a org da atividade
  SELECT w.org_id INTO v_org_id
  FROM activities a
  JOIN campaigns  c ON c.id = a.campaign_id
  JOIN workspaces w ON w.id = c.workspace_id
  WHERE a.id = p_activity_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Atividade não encontrada';
  END IF;

  -- Valida que o autor da ação é membro da org
  IF NOT EXISTS (
    SELECT 1 FROM organization_members
    WHERE org_id = v_org_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  -- Valida que o responsável também é membro da org
  IF NOT EXISTS (
    SELECT 1 FROM organization_members
    WHERE org_id = v_org_id AND user_id = p_assignee_id
  ) THEN
    RAISE EXCEPTION 'Responsável não é membro da organização';
  END IF;

  -- Toggle
  SELECT EXISTS (
    SELECT 1 FROM activity_assignees
    WHERE activity_id = p_activity_id AND user_id = p_assignee_id
  ) INTO v_exists;

  IF v_exists THEN
    DELETE FROM activity_assignees
    WHERE activity_id = p_activity_id AND user_id = p_assignee_id;
    RETURN false;  -- removido
  ELSE
    INSERT INTO activity_assignees (activity_id, user_id)
    VALUES (p_activity_id, p_assignee_id)
    ON CONFLICT DO NOTHING;
    RETURN true;   -- atribuído
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION toggle_activity_assignee(uuid, uuid, uuid) TO anon, authenticated;

-- Índice para queries de responsáveis por atividade
CREATE INDEX IF NOT EXISTS idx_activity_assignees_activity ON activity_assignees(activity_id);
CREATE INDEX IF NOT EXISTS idx_activity_assignees_user    ON activity_assignees(user_id);
