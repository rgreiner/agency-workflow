-- Atualiza start_date e due_date em uma única transação (para o Gantt drag & resize)
CREATE OR REPLACE FUNCTION update_activity_dates(
  p_user_id     uuid,
  p_activity_id uuid,
  p_start_date  date,
  p_due_date    date
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT w.org_id INTO v_org_id
  FROM activities a
  JOIN campaigns  c ON c.id = a.campaign_id
  JOIN workspaces w ON w.id = c.workspace_id
  WHERE a.id = p_activity_id;

  IF NOT EXISTS (
    SELECT 1 FROM organization_members
    WHERE org_id = v_org_id AND user_id = p_user_id
  ) THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  UPDATE activities
  SET start_date = p_start_date, due_date = p_due_date, updated_at = now()
  WHERE id = p_activity_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_activity_dates(uuid,uuid,date,date) TO anon, authenticated;
