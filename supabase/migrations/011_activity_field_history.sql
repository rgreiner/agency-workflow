-- Activity field-level change history
CREATE TABLE IF NOT EXISTS activity_field_history (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid        NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  changed_by  uuid        NOT NULL REFERENCES profiles(id),
  field_name  text        NOT NULL,
  old_value   text,
  new_value   text,
  changed_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE activity_field_history ENABLE ROW LEVEL SECURITY;

-- Org members can view history for activities in their org
CREATE POLICY "members view activity field history"
ON activity_field_history FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM   activities  a
    JOIN   campaigns   c  ON c.id = a.campaign_id
    JOIN   workspaces  w  ON w.id = c.workspace_id
    JOIN   organization_members om ON om.org_id = w.org_id
    WHERE  a.id = activity_field_history.activity_id
      AND  om.user_id = auth.uid()
  )
);

-- RPC: update a single activity field + log the change
-- Runs as SECURITY DEFINER → bypasses RLS on activities and field history
CREATE OR REPLACE FUNCTION update_activity_field(
  p_user_id    uuid,
  p_activity_id uuid,
  p_field       text,
  p_value       text   -- null means clear the field
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id       uuid;
  v_role         text;
  v_old_value    text;
  v_allowed      text[] := ARRAY[
    'title','description','due_date','start_date','priority','complexity',
    'estimated_hours','drive_folder_url','redacao_url','layout_url',
    'finalizacao_url','orcamento'
  ];
  v_mgr_only     text[] := ARRAY[
    'title','due_date','start_date','priority','complexity','estimated_hours'
  ];
BEGIN
  IF NOT (p_field = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'Campo não permitido: %', p_field;
  END IF;

  SELECT w.org_id INTO v_org_id
  FROM   activities a
  JOIN   campaigns  c ON c.id = a.campaign_id
  JOIN   workspaces w ON w.id = c.workspace_id
  WHERE  a.id = p_activity_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Atividade não encontrada';
  END IF;

  SELECT role INTO v_role
  FROM   organization_members
  WHERE  org_id = v_org_id AND user_id = p_user_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  IF p_field = ANY(v_mgr_only) AND v_role NOT IN ('owner','admin','manager') THEN
    RAISE EXCEPTION 'Sem permissão para editar este campo';
  END IF;

  -- Capture old value
  EXECUTE format('SELECT (%I)::text FROM activities WHERE id = $1', p_field)
    INTO v_old_value USING p_activity_id;

  -- Apply update (cast numeric for estimated_hours)
  IF p_field = 'estimated_hours' THEN
    IF p_value IS NULL OR trim(p_value) = '' THEN
      UPDATE activities SET estimated_hours = NULL          WHERE id = p_activity_id;
    ELSE
      UPDATE activities SET estimated_hours = p_value::numeric WHERE id = p_activity_id;
    END IF;
  ELSE
    EXECUTE format('UPDATE activities SET %I = $1 WHERE id = $2', p_field)
      USING NULLIF(trim(p_value), ''), p_activity_id;
  END IF;

  -- Log only if value actually changed
  IF v_old_value IS DISTINCT FROM p_value THEN
    INSERT INTO activity_field_history
      (activity_id, changed_by, field_name, old_value, new_value)
    VALUES
      (p_activity_id, p_user_id, p_field, v_old_value, p_value);
  END IF;
END;
$$;
