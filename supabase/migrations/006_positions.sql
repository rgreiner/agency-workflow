-- ──────────────────────────────────────────────
-- CARGOS DA ORGANIZAÇÃO
-- ──────────────────────────────────────────────

CREATE TABLE org_positions (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  color           text NOT NULL DEFAULT '#6366f1',
  allowed_statuses activity_status[] NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, name)
);

ALTER TABLE org_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can read positions" ON org_positions
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM organization_members WHERE org_id = org_positions.org_id AND user_id = auth.uid()
  ));

CREATE POLICY "Owner/admin can manage positions" ON org_positions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE org_id = org_positions.org_id AND user_id = auth.uid()
      AND role IN ('owner','admin')
    )
  );

CREATE INDEX idx_org_positions_org ON org_positions(org_id);

-- Adiciona cargo em organization_members
ALTER TABLE organization_members
  ADD COLUMN IF NOT EXISTS position_id uuid REFERENCES org_positions(id) ON DELETE SET NULL;

-- ──────────────────────────────────────────────
-- FUNÇÕES SECURITY DEFINER
-- ──────────────────────────────────────────────

-- Cria cargo
CREATE OR REPLACE FUNCTION create_org_position(
  p_user_id        uuid,
  p_org_id         uuid,
  p_name           text,
  p_color          text,
  p_allowed_statuses activity_status[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM organization_members
    WHERE org_id = p_org_id AND user_id = p_user_id AND role IN ('owner','admin')
  ) THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  INSERT INTO org_positions (org_id, name, color, allowed_statuses)
  VALUES (p_org_id, p_name, p_color, p_allowed_statuses)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Atualiza cargo
CREATE OR REPLACE FUNCTION update_org_position(
  p_user_id        uuid,
  p_position_id    uuid,
  p_name           text,
  p_color          text,
  p_allowed_statuses activity_status[]
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM org_positions pos
    JOIN organization_members m ON m.org_id = pos.org_id
    WHERE pos.id = p_position_id AND m.user_id = p_user_id AND m.role IN ('owner','admin')
  ) THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  UPDATE org_positions SET name = p_name, color = p_color, allowed_statuses = p_allowed_statuses
  WHERE id = p_position_id;
END;
$$;

-- Remove cargo
CREATE OR REPLACE FUNCTION delete_org_position(
  p_user_id     uuid,
  p_position_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM org_positions pos
    JOIN organization_members m ON m.org_id = pos.org_id
    WHERE pos.id = p_position_id AND m.user_id = p_user_id AND m.role IN ('owner','admin')
  ) THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  -- Desvincula membros antes de deletar
  UPDATE organization_members SET position_id = NULL WHERE position_id = p_position_id;
  DELETE FROM org_positions WHERE id = p_position_id;
END;
$$;

-- Atualiza membro (cargo + role)
CREATE OR REPLACE FUNCTION update_member(
  p_user_id     uuid,
  p_org_id      uuid,
  p_member_id   uuid,
  p_position_id uuid,
  p_role        member_role
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM organization_members
    WHERE org_id = p_org_id AND user_id = p_user_id AND role IN ('owner','admin')
  ) THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  -- Não pode rebaixar o próprio owner
  IF p_user_id = p_member_id AND p_role != 'owner' THEN
    RAISE EXCEPTION 'Não é possível alterar o próprio papel de owner';
  END IF;

  UPDATE organization_members
  SET position_id = p_position_id, role = p_role
  WHERE id = p_member_id AND org_id = p_org_id;
END;
$$;

-- Remove membro
CREATE OR REPLACE FUNCTION remove_member(
  p_user_id   uuid,
  p_org_id    uuid,
  p_member_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM organization_members
    WHERE org_id = p_org_id AND user_id = p_user_id AND role IN ('owner','admin')
  ) THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  DELETE FROM organization_members WHERE id = p_member_id AND org_id = p_org_id;
END;
$$;

-- Seed de cargos padrão ao criar organização
CREATE OR REPLACE FUNCTION seed_default_positions(p_org_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO org_positions (org_id, name, color, allowed_statuses) VALUES
    (p_org_id, 'Gestão',      '#6366f1', ARRAY[
      'briefing','pendente_cliente','planejamento','insight','redacao','design','edicao',
      'finalizacao','revisao_interna','validacao_atendimento','orcamento',
      'producao_fornecedores','producao_audiovisual','validacao_midia','midia','social',
      'aprovacao_cliente','implantacao_digital','implantacao_off','concluido'
    ]::activity_status[]),
    (p_org_id, 'Atendimento', '#f97316', ARRAY[
      'briefing','pendente_cliente','planejamento','validacao_atendimento',
      'aprovacao_cliente','implantacao_digital','implantacao_off','concluido'
    ]::activity_status[]),
    (p_org_id, 'Redação',     '#14b8a6', ARRAY['insight','redacao']::activity_status[]),
    (p_org_id, 'Design',      '#ec4899', ARRAY['design','edicao','finalizacao']::activity_status[]),
    (p_org_id, 'Produção',    '#f59e0b', ARRAY['producao_fornecedores','producao_audiovisual']::activity_status[]),
    (p_org_id, 'Mídia',       '#8b5cf6', ARRAY['validacao_midia','midia','social']::activity_status[]);
END;
$$;

GRANT EXECUTE ON FUNCTION create_org_position(uuid,uuid,text,text,activity_status[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_org_position(uuid,uuid,text,text,activity_status[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION delete_org_position(uuid,uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_member(uuid,uuid,uuid,uuid,member_role) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION remove_member(uuid,uuid,uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION seed_default_positions(uuid) TO anon, authenticated;
