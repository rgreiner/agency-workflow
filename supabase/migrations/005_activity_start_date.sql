-- Adiciona data de início nas atividades (necessário para o Gantt)
ALTER TABLE activities ADD COLUMN IF NOT EXISTS start_date timestamptz;

-- Atualiza create_activity para aceitar start_date
CREATE OR REPLACE FUNCTION create_activity(
  p_user_id     uuid,
  p_campaign_id uuid,
  p_title       text,
  p_description text,
  p_status      activity_status,
  p_priority    activity_priority,
  p_complexity  activity_complexity,
  p_due_date    timestamptz,
  p_estimated_hours numeric,
  p_start_date  timestamptz DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM campaigns c
    JOIN workspaces w ON w.id = c.workspace_id
    JOIN organization_members m ON m.org_id = w.org_id
    WHERE c.id = p_campaign_id AND m.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  INSERT INTO activities (campaign_id, title, description, status, priority, complexity, due_date, estimated_hours, start_date, created_by)
  VALUES (p_campaign_id, p_title, NULLIF(p_description,''), p_status, p_priority, p_complexity, p_due_date, p_estimated_hours, p_start_date, p_user_id)
  RETURNING id INTO v_id;

  INSERT INTO activity_history (activity_id, from_status, to_status, changed_by)
  VALUES (v_id, NULL, p_status, p_user_id);

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_activity(uuid,uuid,text,text,activity_status,activity_priority,activity_complexity,timestamptz,numeric,timestamptz) TO anon, authenticated;
