-- 202_update_activity_field_cast.sql
-- Bug reportado pelo Rafael em 03/08: mudar a prioridade de uma tarefa devolve
--   column "priority" is of type activity_priority but expression is of type text
--
-- Reproduzido em produção: o ramo genérico do `update_activity_field` monta
--   EXECUTE format('UPDATE activities SET %I = $1 WHERE id = $2', p_field) USING <text>
-- e o Postgres não converte um PARÂMETRO text para enum implicitamente. Vale
-- para `priority` (activity_priority) e também para `complexity`
-- (activity_complexity) — dos 14 campos do allowlist, são os dois enums, e os
-- dois estavam quebrados.
--
-- Correção: em vez de tratar enum por enum, o cast passa a sair do CATÁLOGO —
-- `format_type` diz o tipo real da coluna e o UPDATE converte para ele. Assim
-- qualquer coluna futura (enum novo, uuid, boolean) entra sem tocar aqui de novo,
-- que é o tipo de manutenção que ninguém lembra de fazer.
--
-- Idempotente.

create or replace function update_activity_field(p_user_id uuid, p_activity_id uuid, p_field text, p_value text)
returns void language plpgsql security definer set search_path to 'public' as $function$
DECLARE
  v_org_id    uuid;
  v_role      text;
  v_old_value text;
  v_tipo      text;
  v_allowed   text[] := ARRAY[
    'title','description','due_date','start_date','priority','complexity',
    'estimated_hours','drive_folder_url','drive_path','redacao_url','layout_url',
    'finalizacao_url','preview_url','orcamento'
  ];
BEGIN
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
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

  EXECUTE format('SELECT (%I)::text FROM activities WHERE id = $1', p_field)
    INTO v_old_value USING p_activity_id;

  -- Tipo REAL da coluna, direto do catálogo. `p_field` já passou pelo allowlist,
  -- e `format_type` devolve um nome de tipo qualificado — nada aqui vem do usuário.
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_tipo
    FROM pg_attribute a
   WHERE a.attrelid = 'activities'::regclass AND a.attname = p_field
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_tipo IS NULL THEN
    RAISE EXCEPTION 'Campo inexistente em activities: %', p_field;
  END IF;

  IF p_value IS NULL OR trim(p_value) = '' THEN
    -- Vazio é NULL em qualquer tipo — inclusive nos que não aceitam string vazia
    -- (numeric, date, enum), onde o cast de '' estouraria.
    EXECUTE format('UPDATE activities SET %I = NULL WHERE id = $1', p_field)
      USING p_activity_id;
  ELSE
    EXECUTE format('UPDATE activities SET %I = $1::%s WHERE id = $2', p_field, v_tipo)
      USING trim(p_value), p_activity_id;
  END IF;

  IF v_old_value IS DISTINCT FROM p_value THEN
    INSERT INTO activity_field_history
      (activity_id, changed_by, field_name, old_value, new_value)
    VALUES
      (p_activity_id, p_user_id, p_field, v_old_value, p_value);
  END IF;
END;
$function$;

revoke execute on function update_activity_field(uuid, uuid, text, text) from public, anon;
grant  execute on function update_activity_field(uuid, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
