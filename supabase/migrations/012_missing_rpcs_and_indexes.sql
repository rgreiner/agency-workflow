-- ── update_activity_links ────────────────────────────────────────────────────
-- Chamada ao salvar links de uma atividade (Drive, Redação, Layout, etc.)
-- Não estava em nenhuma migration anterior, o que causava erro ao criar atividades com links.

CREATE OR REPLACE FUNCTION update_activity_links(
  p_user_id           uuid,
  p_activity_id       uuid,
  p_drive_folder_url  text,
  p_redacao_url       text,
  p_layout_url        text,
  p_finalizacao_url   text,
  p_orcamento         text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Valida que o usuário é membro da org desta atividade
  IF NOT EXISTS (
    SELECT 1
    FROM activities a
    JOIN campaigns  c ON c.id  = a.campaign_id
    JOIN workspaces w ON w.id  = c.workspace_id
    JOIN organization_members om ON om.org_id = w.org_id
    WHERE a.id = p_activity_id AND om.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  UPDATE activities SET
    drive_folder_url = p_drive_folder_url,
    redacao_url      = p_redacao_url,
    layout_url       = p_layout_url,
    finalizacao_url  = p_finalizacao_url,
    orcamento        = p_orcamento,
    updated_at       = now()
  WHERE id = p_activity_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_activity_links(uuid,uuid,text,text,text,text,text) TO anon, authenticated;

-- ── Índices em falta ─────────────────────────────────────────────────────────

-- documents: buscas por visibilidade e org
CREATE INDEX IF NOT EXISTS idx_documents_org_id     ON documents(org_id);
CREATE INDEX IF NOT EXISTS idx_documents_visibility ON documents(org_id, visibility);
CREATE INDEX IF NOT EXISTS idx_documents_created_by ON documents(created_by);

-- activity_field_history: leituras por atividade + campo
CREATE INDEX IF NOT EXISTS idx_field_history_activity  ON activity_field_history(activity_id);
CREATE INDEX IF NOT EXISTS idx_field_history_field     ON activity_field_history(activity_id, field_name);
CREATE INDEX IF NOT EXISTS idx_field_history_changed_by ON activity_field_history(changed_by);
