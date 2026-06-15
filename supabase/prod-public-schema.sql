--
-- PostgreSQL database dump
--

\restrict kBYW5UjBCpYJKKe8owhlOwYXPOMf31A3y50q1yi6QnhkGg9t65MZDSy7Nfh7Q3b

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.10 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: activity_complexity; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.activity_complexity AS ENUM (
    'simple',
    'medium',
    'complex'
);


--
-- Name: activity_priority; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.activity_priority AS ENUM (
    'low',
    'medium',
    'high',
    'urgent'
);


--
-- Name: activity_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.activity_status AS ENUM (
    'briefing',
    'pendente_cliente',
    'planejamento',
    'insight',
    'redacao',
    'design',
    'edicao',
    'finalizacao',
    'revisao_interna',
    'validacao_atendimento',
    'orcamento',
    'producao_fornecedores',
    'producao_audiovisual',
    'validacao_midia',
    'midia',
    'social',
    'aprovacao_cliente',
    'implantacao_digital',
    'implantacao_off',
    'concluido'
);


--
-- Name: member_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.member_role AS ENUM (
    'owner',
    'admin',
    'manager',
    'member',
    'viewer'
);


--
-- Name: org_plan; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.org_plan AS ENUM (
    'free',
    'starter',
    'pro',
    'enterprise'
);


--
-- Name: accept_invite_link(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.accept_invite_link(p_user_id uuid, p_token uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_link org_invite_links%ROWTYPE; v_slug text; v_exists boolean;
BEGIN
  SELECT * INTO v_link FROM org_invite_links WHERE token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'Link não encontrado'; END IF;
  IF NOT v_link.is_active THEN RAISE EXCEPTION 'Link inativo'; END IF;
  SELECT slug INTO v_slug FROM organizations WHERE id = v_link.org_id;
  SELECT EXISTS (SELECT 1 FROM organization_members WHERE org_id = v_link.org_id AND user_id = p_user_id) INTO v_exists;
  IF v_exists THEN RETURN v_slug; END IF;
  INSERT INTO organization_members (org_id, user_id, role, invited_by) VALUES (v_link.org_id, p_user_id, v_link.role, v_link.created_by);
  UPDATE org_invite_links SET use_count = use_count + 1 WHERE id = v_link.id;
  RETURN v_slug;
END;
$$;


--
-- Name: add_activity_comment(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_activity_comment(p_user_id uuid, p_activity_id uuid, p_content text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_id uuid;
begin
  if not exists (
    select 1 from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    join organization_members m on m.org_id = w.org_id
    where a.id = p_activity_id and m.user_id = p_user_id
  ) then
    raise exception 'Acesso negado';
  end if;

  insert into activity_comments (activity_id, user_id, content)
  values (p_activity_id, p_user_id, p_content)
  returning id into v_id;

  return v_id;
end;
$$;


--
-- Name: can_manage_doc(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_manage_doc(p_doc_id uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM documents
    WHERE id = p_doc_id
      AND (
        created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM organization_members
          WHERE org_id = (SELECT org_id FROM documents WHERE id = p_doc_id)
            AND user_id = auth.uid()
            AND role IN ('owner', 'admin')
        )
      )
  );
$$;


--
-- Name: create_activity(uuid, uuid, text, text, public.activity_status, public.activity_priority, public.activity_complexity, timestamp with time zone, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_activity(p_user_id uuid, p_campaign_id uuid, p_title text, p_description text, p_status public.activity_status, p_priority public.activity_priority, p_complexity public.activity_complexity, p_due_date timestamp with time zone, p_estimated_hours numeric) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_id uuid;
begin
  if not exists (
    select 1 from campaigns c
    join workspaces w on w.id = c.workspace_id
    join organization_members m on m.org_id = w.org_id
    where c.id = p_campaign_id and m.user_id = p_user_id
  ) then
    raise exception 'Acesso negado';
  end if;

  insert into activities (campaign_id, title, description, status, priority, complexity, due_date, estimated_hours, created_by)
  values (p_campaign_id, p_title, nullif(p_description,''), p_status, p_priority, p_complexity, p_due_date, p_estimated_hours, p_user_id)
  returning id into v_id;

  -- Registra no histórico
  insert into activity_history (activity_id, from_status, to_status, changed_by)
  values (v_id, null, p_status, p_user_id);

  return v_id;
end;
$$;


--
-- Name: create_activity(uuid, uuid, text, text, text, text, text, date, numeric, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_activity(p_user_id uuid, p_campaign_id uuid, p_title text, p_description text DEFAULT ''::text, p_status text DEFAULT 'briefing'::text, p_priority text DEFAULT 'medium'::text, p_complexity text DEFAULT 'medium'::text, p_due_date date DEFAULT NULL::date, p_estimated_hours numeric DEFAULT NULL::numeric, p_start_date date DEFAULT NULL::date) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Verifica se o usuário tem acesso à campanha
  IF NOT EXISTS (
    SELECT 1 FROM campaigns c
    JOIN workspaces w ON w.id = c.workspace_id
    JOIN organization_members m ON m.org_id = w.org_id
    WHERE c.id = p_campaign_id AND m.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  INSERT INTO activities (
    campaign_id, title, description, status,
    priority, complexity, due_date, estimated_hours,
    start_date, created_by
  ) VALUES (
    p_campaign_id, p_title, p_description, p_status::activity_status,
    p_priority::activity_priority, p_complexity::activity_complexity,
    p_due_date, p_estimated_hours, p_start_date, p_user_id
  )
  RETURNING id INTO v_id;

  -- Registra no histórico
  INSERT INTO activity_history (activity_id, changed_by, to_status)
  VALUES (v_id, p_user_id, p_status::activity_status);

  RETURN v_id;
END;
$$;


--
-- Name: create_campaign(uuid, uuid, text, text, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_campaign(p_user_id uuid, p_workspace_id uuid, p_name text, p_description text, p_start_date date, p_end_date date) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_id uuid;
begin
  if not exists (
    select 1 from workspaces w
    join organization_members m on m.org_id = w.org_id
    where w.id = p_workspace_id and m.user_id = p_user_id
  ) then
    raise exception 'Acesso negado';
  end if;
  insert into campaigns (workspace_id, name, description, start_date, end_date, created_by)
  values (p_workspace_id, p_name, nullif(p_description,''), p_start_date, p_end_date, p_user_id)
  returning id into v_id;
  return v_id;
end;
$$;


--
-- Name: create_org_for_user(uuid, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_org_for_user(p_user_id uuid, p_name text, p_slug text, p_type text, p_size text, p_segment text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_org_id uuid;
begin
  insert into organizations (name, slug, plan, max_members, company_type, company_size, segment)
  values (p_name, p_slug, 'free', 5, p_type, p_size, p_segment)
  returning id into v_org_id;

  insert into organization_members (org_id, user_id, role)
  values (v_org_id, p_user_id, 'owner');

  return v_org_id;
end;
$$;


--
-- Name: create_org_position(uuid, uuid, text, text, public.activity_status[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_org_position(p_user_id uuid, p_org_id uuid, p_name text, p_color text, p_allowed_statuses public.activity_status[]) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: create_workspace(uuid, uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_workspace(p_user_id uuid, p_org_id uuid, p_name text, p_description text, p_color text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_id uuid;
begin
  if not exists (select 1 from organization_members where org_id = p_org_id and user_id = p_user_id) then
    raise exception 'Acesso negado';
  end if;
  insert into workspaces (org_id, name, description, color, created_by)
  values (p_org_id, p_name, nullif(p_description,''), p_color, p_user_id)
  returning id into v_id;
  return v_id;
end;
$$;


--
-- Name: deactivate_invite_link(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deactivate_invite_link(p_user_id uuid, p_org_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_caller_role member_role;
BEGIN
  SELECT role INTO v_caller_role FROM organization_members WHERE org_id = p_org_id AND user_id = p_user_id;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Permissão negada'; END IF;
  UPDATE org_invite_links SET is_active = false WHERE org_id = p_org_id AND is_active = true;
END;
$$;


--
-- Name: delete_org_position(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_org_position(p_user_id uuid, p_position_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: get_invite_info(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_invite_info(p_token uuid) RETURNS TABLE(token uuid, is_active boolean, role public.member_role, org_name text, org_slug text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    il.token,
    il.is_active,
    il.role,
    o.name  AS org_name,
    o.slug  AS org_slug
  FROM org_invite_links il
  JOIN organizations o ON o.id = il.org_id
  WHERE il.token = p_token;
END;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;


--
-- Name: has_doc_access(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_doc_access(p_doc_id uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM documents
    WHERE id = p_doc_id
      AND is_org_member(org_id)
      AND (
        visibility = 'org'
        OR created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM document_members
          WHERE document_id = p_doc_id AND user_id = auth.uid()
        )
      )
  );
$$;


--
-- Name: is_coworker(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_coworker(p_profile_id uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members om1
    JOIN organization_members om2 ON om1.org_id = om2.org_id
    WHERE om1.user_id = p_profile_id AND om2.user_id = auth.uid()
  );
$$;


--
-- Name: is_doc_org_member(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_doc_org_member(p_doc_id uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM documents
    WHERE id = p_doc_id AND is_org_member(org_id)
  );
$$;


--
-- Name: is_org_member(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_org_member(org uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  select exists (
    select 1 from organization_members
    where org_id = org and user_id = auth.uid()
  );
$$;


--
-- Name: org_member_role(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.org_member_role(org uuid) RETURNS public.member_role
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  select role from organization_members
  where org_id = org and user_id = auth.uid()
  limit 1;
$$;


--
-- Name: remove_member(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.remove_member(p_user_id uuid, p_org_id uuid, p_member_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM organization_members
    WHERE org_id = p_org_id AND user_id = p_user_id AND role IN ('owner','admin')
  ) THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  DELETE FROM organization_members WHERE id = p_member_id AND org_id = p_org_id;
END;
$$;


--
-- Name: seed_default_positions(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_default_positions(p_org_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: toggle_activity_assignee(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.toggle_activity_assignee(p_user_id uuid, p_activity_id uuid, p_assignee_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: update_activity_dates(uuid, uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_activity_dates(p_user_id uuid, p_activity_id uuid, p_start_date date, p_due_date date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: update_activity_field(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_activity_field(p_user_id uuid, p_activity_id uuid, p_field text, p_value text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  v_org_id    uuid;
  v_role      text;
  v_old_value text;
  v_allowed   text[] := ARRAY[
    'title','description','due_date','start_date','priority','complexity',
    'estimated_hours','drive_folder_url','redacao_url','layout_url',
    'finalizacao_url','orcamento'
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

  -- Capture old value as text
  EXECUTE format('SELECT (%I)::text FROM activities WHERE id = $1', p_field)
    INTO v_old_value USING p_activity_id;

  -- Apply update with type-aware casting
  IF p_field = 'estimated_hours' THEN
    IF p_value IS NULL OR trim(p_value) = '' THEN
      UPDATE activities SET estimated_hours = NULL WHERE id = p_activity_id;
    ELSE
      UPDATE activities SET estimated_hours = p_value::numeric WHERE id = p_activity_id;
    END IF;
  ELSIF p_field IN ('start_date', 'due_date') THEN
    IF p_value IS NULL OR trim(p_value) = '' THEN
      EXECUTE format('UPDATE activities SET %I = NULL WHERE id = $1', p_field)
        USING p_activity_id;
    ELSE
      EXECUTE format('UPDATE activities SET %I = $1::date WHERE id = $2', p_field)
        USING trim(p_value), p_activity_id;
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
$_$;


--
-- Name: update_activity_links(uuid, uuid, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_activity_links(p_user_id uuid, p_activity_id uuid, p_drive_folder_url text, p_redacao_url text, p_layout_url text, p_finalizacao_url text, p_orcamento text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: update_activity_status(uuid, uuid, public.activity_status, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_activity_status(p_user_id uuid, p_activity_id uuid, p_new_status public.activity_status, p_comment text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_old_status activity_status;
begin
  select status into v_old_status from activities where id = p_activity_id;

  if not exists (
    select 1 from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    join organization_members m on m.org_id = w.org_id
    where a.id = p_activity_id and m.user_id = p_user_id
  ) then
    raise exception 'Acesso negado';
  end if;

  update activities set status = p_new_status, updated_at = now() where id = p_activity_id;

  insert into activity_history (activity_id, from_status, to_status, changed_by, comment)
  values (p_activity_id, v_old_status, p_new_status, p_user_id, nullif(p_comment,''));
end;
$$;


--
-- Name: update_member(uuid, uuid, uuid, uuid, public.member_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_member(p_user_id uuid, p_org_id uuid, p_member_id uuid, p_position_id uuid, p_role public.member_role) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: update_org_position(uuid, uuid, text, text, public.activity_status[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_org_position(p_user_id uuid, p_position_id uuid, p_name text, p_color text, p_allowed_statuses public.activity_status[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: update_profile(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_profile(p_full_name text, p_avatar_url text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE profiles
  SET full_name  = p_full_name,
      avatar_url = p_avatar_url,
      updated_at = now()
  WHERE id = auth.uid();
END;
$$;


--
-- Name: upsert_invite_link(uuid, uuid, public.member_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_invite_link(p_user_id uuid, p_org_id uuid, p_role public.member_role) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_caller_role member_role; v_token uuid;
BEGIN
  SELECT role INTO v_caller_role FROM organization_members WHERE org_id = p_org_id AND user_id = p_user_id;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Permissão negada'; END IF;
  UPDATE org_invite_links SET is_active = false WHERE org_id = p_org_id AND role = p_role AND is_active = true;
  INSERT INTO org_invite_links (org_id, role, created_by) VALUES (p_org_id, p_role, p_user_id) RETURNING token INTO v_token;
  RETURN v_token;
END;
$$;


--
-- Name: upsert_org_settings(uuid, uuid, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_org_settings(p_user_id uuid, p_org_id uuid, p_logo_url text, p_accent_color text, p_status_overrides jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activities (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    campaign_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    status public.activity_status DEFAULT 'briefing'::public.activity_status NOT NULL,
    priority public.activity_priority DEFAULT 'medium'::public.activity_priority NOT NULL,
    complexity public.activity_complexity DEFAULT 'medium'::public.activity_complexity NOT NULL,
    due_date timestamp with time zone,
    estimated_hours numeric(5,2),
    sort_order integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    drive_folder_url text,
    redacao_url text,
    layout_url text,
    finalizacao_url text,
    orcamento text,
    start_date date
);


--
-- Name: activity_assignees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_assignees (
    activity_id uuid NOT NULL,
    user_id uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: activity_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_comments (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    activity_id uuid NOT NULL,
    user_id uuid NOT NULL,
    content text NOT NULL,
    attachments jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: activity_field_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_field_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    activity_id uuid NOT NULL,
    changed_by uuid NOT NULL,
    field_name text NOT NULL,
    old_value text,
    new_value text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: activity_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_history (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    activity_id uuid NOT NULL,
    from_status public.activity_status,
    to_status public.activity_status NOT NULL,
    changed_by uuid,
    comment text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: activity_status_assignees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_status_assignees (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    activity_id uuid NOT NULL,
    status public.activity_status NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaigns (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    start_date date,
    end_date date,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: document_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_members (
    document_id uuid NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    workspace_id uuid,
    parent_id uuid,
    title text DEFAULT 'Sem título'::text NOT NULL,
    content jsonb DEFAULT '{"type": "doc", "content": []}'::jsonb NOT NULL,
    visibility text DEFAULT 'org'::text NOT NULL,
    created_by uuid NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT documents_visibility_check CHECK ((visibility = ANY (ARRAY['org'::text, 'custom'::text])))
);


--
-- Name: invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitations (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    email text NOT NULL,
    role public.member_role DEFAULT 'member'::public.member_role NOT NULL,
    token text DEFAULT encode(extensions.gen_random_bytes(32), 'hex'::text) NOT NULL,
    invited_by uuid,
    accepted_at timestamp with time zone,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: org_invite_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_invite_links (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    token uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    role public.member_role DEFAULT 'member'::public.member_role NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    use_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: org_positions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_positions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    color text DEFAULT '#6366f1'::text NOT NULL,
    allowed_statuses public.activity_status[] DEFAULT '{}'::public.activity_status[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: org_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_settings (
    org_id uuid NOT NULL,
    logo_url text,
    accent_color text DEFAULT '#6366f1'::text NOT NULL,
    status_overrides jsonb DEFAULT '[]'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: organization_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_members (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role public.member_role DEFAULT 'member'::public.member_role NOT NULL,
    invited_by uuid,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    position_id uuid
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    plan public.org_plan DEFAULT 'free'::public.org_plan NOT NULL,
    max_members integer DEFAULT 5 NOT NULL,
    logo_url text,
    stripe_customer_id text,
    stripe_subscription_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    company_type text,
    company_size text,
    segment text
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text NOT NULL,
    full_name text,
    avatar_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    role_title text,
    phone text
);


--
-- Name: visual_boards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visual_boards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    workspace_id uuid,
    title text DEFAULT 'Quadro sem título'::text NOT NULL,
    data jsonb DEFAULT '{"arrows": [], "elements": []}'::jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspaces (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    color text DEFAULT '#6366f1'::text NOT NULL,
    archived boolean DEFAULT false NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: activities activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_pkey PRIMARY KEY (id);


--
-- Name: activity_assignees activity_assignees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_assignees
    ADD CONSTRAINT activity_assignees_pkey PRIMARY KEY (activity_id, user_id);


--
-- Name: activity_comments activity_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_comments
    ADD CONSTRAINT activity_comments_pkey PRIMARY KEY (id);


--
-- Name: activity_field_history activity_field_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_field_history
    ADD CONSTRAINT activity_field_history_pkey PRIMARY KEY (id);


--
-- Name: activity_history activity_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_history
    ADD CONSTRAINT activity_history_pkey PRIMARY KEY (id);


--
-- Name: activity_status_assignees activity_status_assignees_activity_id_status_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_status_assignees
    ADD CONSTRAINT activity_status_assignees_activity_id_status_key UNIQUE (activity_id, status);


--
-- Name: activity_status_assignees activity_status_assignees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_status_assignees
    ADD CONSTRAINT activity_status_assignees_pkey PRIMARY KEY (id);


--
-- Name: campaigns campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_pkey PRIMARY KEY (id);


--
-- Name: document_members document_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_members
    ADD CONSTRAINT document_members_pkey PRIMARY KEY (document_id, user_id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_token_key UNIQUE (token);


--
-- Name: org_invite_links org_invite_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_invite_links
    ADD CONSTRAINT org_invite_links_pkey PRIMARY KEY (id);


--
-- Name: org_invite_links org_invite_links_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_invite_links
    ADD CONSTRAINT org_invite_links_token_key UNIQUE (token);


--
-- Name: org_positions org_positions_org_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_positions
    ADD CONSTRAINT org_positions_org_id_name_key UNIQUE (org_id, name);


--
-- Name: org_positions org_positions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_positions
    ADD CONSTRAINT org_positions_pkey PRIMARY KEY (id);


--
-- Name: org_settings org_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_settings
    ADD CONSTRAINT org_settings_pkey PRIMARY KEY (org_id);


--
-- Name: organization_members organization_members_org_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_org_id_user_id_key UNIQUE (org_id, user_id);


--
-- Name: organization_members organization_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_slug_key UNIQUE (slug);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: visual_boards visual_boards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visual_boards
    ADD CONSTRAINT visual_boards_pkey PRIMARY KEY (id);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- Name: idx_activities_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_campaign ON public.activities USING btree (campaign_id);


--
-- Name: idx_activities_due_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_due_date ON public.activities USING btree (due_date);


--
-- Name: idx_activities_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_status ON public.activities USING btree (status);


--
-- Name: idx_activity_assignees_activity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_assignees_activity ON public.activity_status_assignees USING btree (activity_id);


--
-- Name: idx_activity_assignees_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_assignees_user ON public.activity_assignees USING btree (user_id);


--
-- Name: idx_activity_history_activity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_history_activity ON public.activity_history USING btree (activity_id);


--
-- Name: idx_campaigns_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaigns_workspace ON public.campaigns USING btree (workspace_id);


--
-- Name: idx_documents_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_created ON public.documents USING btree (created_by);


--
-- Name: idx_documents_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_created_by ON public.documents USING btree (created_by);


--
-- Name: idx_documents_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_org ON public.documents USING btree (org_id);


--
-- Name: idx_documents_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_org_id ON public.documents USING btree (org_id);


--
-- Name: idx_documents_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_parent ON public.documents USING btree (parent_id);


--
-- Name: idx_documents_visibility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_visibility ON public.documents USING btree (org_id, visibility);


--
-- Name: idx_documents_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_workspace ON public.documents USING btree (workspace_id);


--
-- Name: idx_field_history_activity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_field_history_activity ON public.activity_field_history USING btree (activity_id);


--
-- Name: idx_field_history_changed_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_field_history_changed_by ON public.activity_field_history USING btree (changed_by);


--
-- Name: idx_field_history_field; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_field_history_field ON public.activity_field_history USING btree (activity_id, field_name);


--
-- Name: idx_org_members_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_members_org ON public.organization_members USING btree (org_id);


--
-- Name: idx_org_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_members_user ON public.organization_members USING btree (user_id);


--
-- Name: idx_org_positions_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_positions_org ON public.org_positions USING btree (org_id);


--
-- Name: idx_workspaces_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workspaces_org ON public.workspaces USING btree (org_id);


--
-- Name: visual_boards_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visual_boards_created_by_idx ON public.visual_boards USING btree (created_by);


--
-- Name: visual_boards_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visual_boards_org_id_idx ON public.visual_boards USING btree (org_id);


--
-- Name: visual_boards_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visual_boards_workspace_id_idx ON public.visual_boards USING btree (workspace_id);


--
-- Name: activities set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.activities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: activity_comments set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.activity_comments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: campaigns set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: documents set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: organizations set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: profiles set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: workspaces set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: activities activities_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;


--
-- Name: activities activities_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: activity_assignees activity_assignees_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_assignees
    ADD CONSTRAINT activity_assignees_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE CASCADE;


--
-- Name: activity_assignees activity_assignees_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_assignees
    ADD CONSTRAINT activity_assignees_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: activity_comments activity_comments_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_comments
    ADD CONSTRAINT activity_comments_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE CASCADE;


--
-- Name: activity_comments activity_comments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_comments
    ADD CONSTRAINT activity_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: activity_field_history activity_field_history_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_field_history
    ADD CONSTRAINT activity_field_history_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE CASCADE;


--
-- Name: activity_field_history activity_field_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_field_history
    ADD CONSTRAINT activity_field_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.profiles(id);


--
-- Name: activity_history activity_history_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_history
    ADD CONSTRAINT activity_history_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE CASCADE;


--
-- Name: activity_history activity_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_history
    ADD CONSTRAINT activity_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.profiles(id);


--
-- Name: activity_status_assignees activity_status_assignees_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_status_assignees
    ADD CONSTRAINT activity_status_assignees_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE CASCADE;


--
-- Name: activity_status_assignees activity_status_assignees_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_status_assignees
    ADD CONSTRAINT activity_status_assignees_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: campaigns campaigns_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: campaigns campaigns_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: document_members document_members_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_members
    ADD CONSTRAINT document_members_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: document_members document_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_members
    ADD CONSTRAINT document_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: documents documents_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: documents documents_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: documents documents_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: documents documents_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: invitations invitations_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.profiles(id);


--
-- Name: invitations invitations_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: org_invite_links org_invite_links_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_invite_links
    ADD CONSTRAINT org_invite_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: org_invite_links org_invite_links_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_invite_links
    ADD CONSTRAINT org_invite_links_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: org_positions org_positions_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_positions
    ADD CONSTRAINT org_positions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: org_settings org_settings_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_settings
    ADD CONSTRAINT org_settings_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_members organization_members_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.profiles(id);


--
-- Name: organization_members organization_members_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_members organization_members_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.org_positions(id) ON DELETE SET NULL;


--
-- Name: organization_members organization_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: visual_boards visual_boards_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visual_boards
    ADD CONSTRAINT visual_boards_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: visual_boards visual_boards_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visual_boards
    ADD CONSTRAINT visual_boards_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: visual_boards visual_boards_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visual_boards
    ADD CONSTRAINT visual_boards_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;


--
-- Name: workspaces workspaces_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: workspaces workspaces_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: org_invite_links Anyone can read active invite links; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read active invite links" ON public.org_invite_links FOR SELECT USING ((is_active = true));


--
-- Name: invitations Anyone can read invitation by token; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read invitation by token" ON public.invitations FOR SELECT USING (true);


--
-- Name: organizations Authenticated users can create org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can create org" ON public.organizations FOR INSERT WITH CHECK ((auth.uid() IS NOT NULL));


--
-- Name: documents Creator and admin can delete documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Creator and admin can delete documents" ON public.documents FOR DELETE USING (public.can_manage_doc(id));


--
-- Name: document_members Creator and admin can manage shares; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Creator and admin can manage shares" ON public.document_members USING (public.can_manage_doc(document_id));


--
-- Name: documents Creator and admin can update documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Creator and admin can update documents" ON public.documents FOR UPDATE USING (public.can_manage_doc(id));


--
-- Name: activities Manager+ can delete activities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager+ can delete activities" ON public.activities FOR DELETE USING ((EXISTS ( SELECT 1
   FROM (public.campaigns c
     JOIN public.workspaces w ON ((w.id = c.workspace_id)))
  WHERE ((c.id = activities.campaign_id) AND (public.org_member_role(w.org_id) = ANY (ARRAY['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role]))))));


--
-- Name: campaigns Manager+ can manage campaigns; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager+ can manage campaigns" ON public.campaigns USING ((EXISTS ( SELECT 1
   FROM public.workspaces w
  WHERE ((w.id = campaigns.workspace_id) AND (public.org_member_role(w.org_id) = ANY (ARRAY['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role]))))));


--
-- Name: workspaces Manager+ can manage workspaces; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager+ can manage workspaces" ON public.workspaces USING ((public.org_member_role(org_id) = ANY (ARRAY['owner'::public.member_role, 'admin'::public.member_role, 'manager'::public.member_role])));


--
-- Name: activities Members can create activities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members can create activities" ON public.activities FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.campaigns c
     JOIN public.workspaces w ON ((w.id = c.workspace_id)))
  WHERE ((c.id = activities.campaign_id) AND public.is_org_member(w.org_id)))));


--
-- Name: documents Members can create documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members can create documents" ON public.documents FOR INSERT WITH CHECK ((public.is_org_member(org_id) AND (created_by = auth.uid())));


--
-- Name: activity_history Members can insert history; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members can insert history" ON public.activity_history FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ((public.activities a
     JOIN public.campaigns c ON ((c.id = a.campaign_id)))
     JOIN public.workspaces w ON ((w.id = c.workspace_id)))
  WHERE ((a.id = activity_history.activity_id) AND public.is_org_member(w.org_id)))));


--
-- Name: activity_status_assignees Members can manage assignees; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members can manage assignees" ON public.activity_status_assignees USING ((EXISTS ( SELECT 1
   FROM ((public.activities a
     JOIN public.campaigns c ON ((c.id = a.campaign_id)))
     JOIN public.workspaces w ON ((w.id = c.workspace_id)))
  WHERE ((a.id = activity_status_assignees.activity_id) AND public.is_org_member(w.org_id)))));


--
-- Name: activity_comments Members can manage own comments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members can manage own comments" ON public.activity_comments USING ((user_id = auth.uid()));


--
-- Name: documents Members can read accessible documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members can read accessible documents" ON public.documents FOR SELECT USING (public.has_doc_access(id));


--
-- Name: activities Members can update activities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members can update activities" ON public.activities FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM (public.campaigns c
     JOIN public.workspaces w ON ((w.id = c.workspace_id)))
  WHERE ((c.id = activities.campaign_id) AND public.is_org_member(w.org_id)))));


--
-- Name: invitations Org admin can manage invitations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org admin can manage invitations" ON public.invitations USING ((public.org_member_role(org_id) = ANY (ARRAY['owner'::public.member_role, 'admin'::public.member_role])));


--
-- Name: activity_assignees Org members can manage assignees; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org members can manage assignees" ON public.activity_assignees USING ((EXISTS ( SELECT 1
   FROM ((public.activities a
     JOIN public.campaigns c ON ((c.id = a.campaign_id)))
     JOIN public.workspaces w ON ((w.id = c.workspace_id)))
  WHERE ((a.id = activity_assignees.activity_id) AND public.is_org_member(w.org_id)))));


--
-- Name: activities Org members can read activities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org members can read activities" ON public.activities FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.campaigns c
     JOIN public.workspaces w ON ((w.id = c.workspace_id)))
  WHERE ((c.id = activities.campaign_id) AND public.is_org_member(w.org_id)))));


--
-- Name: activity_assignees Org members can read assignees; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org members can read assignees" ON public.activity_assignees FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ((public.activities a
     JOIN public.campaigns c ON ((c.id = a.campaign_id)))
     JOIN public.workspaces w ON ((w.id = c.workspace_id)))
  WHERE ((a.id = activity_assignees.activity_id) AND public.is_org_member(w.org_id)))));


--
-- Name: activity_status_assignees Org members can read assignees; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org members can read assignees" ON public.activity_status_assignees FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ((public.activities a
     JOIN public.campaigns c ON ((c.id = a.campaign_id)))
     JOIN public.workspaces w ON ((w.id = c.workspace_id)))
  WHERE ((a.id = activity_status_assignees.activity_id) AND public.is_org_member(w.org_id)))));


--
-- Name: campaigns Org members can read campaigns; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org members can read campaigns" ON public.campaigns FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.workspaces w
  WHERE ((w.id = campaigns.workspace_id) AND public.is_org_member(w.org_id)))));


--
-- Name: activity_comments Org members can read comments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org members can read comments" ON public.activity_comments FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ((public.activities a
     JOIN public.campaigns c ON ((c.id = a.campaign_id)))
     JOIN public.workspaces w ON ((w.id = c.workspace_id)))
  WHERE ((a.id = activity_comments.activity_id) AND public.is_org_member(w.org_id)))));


--
-- Name: document_members Org members can read document shares; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org members can read document shares" ON public.document_members FOR SELECT USING (public.is_doc_org_member(document_id));


--
-- Name: activity_history Org members can read history; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org members can read history" ON public.activity_history FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ((public.activities a
     JOIN public.campaigns c ON ((c.id = a.campaign_id)))
     JOIN public.workspaces w ON ((w.id = c.workspace_id)))
  WHERE ((a.id = activity_history.activity_id) AND public.is_org_member(w.org_id)))));


--
-- Name: organization_members Org members can read members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org members can read members" ON public.organization_members FOR SELECT USING (public.is_org_member(org_id));


--
-- Name: organizations Org members can read org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org members can read org" ON public.organizations FOR SELECT USING (public.is_org_member(id));


--
-- Name: org_positions Org members can read positions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org members can read positions" ON public.org_positions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.organization_members
  WHERE ((organization_members.org_id = org_positions.org_id) AND (organization_members.user_id = auth.uid())))));


--
-- Name: workspaces Org members can read workspaces; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org members can read workspaces" ON public.workspaces FOR SELECT USING (public.is_org_member(org_id));


--
-- Name: profiles Org members can view coworker profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org members can view coworker profiles" ON public.profiles FOR SELECT USING (public.is_coworker(id));


--
-- Name: organization_members Owner/admin can delete members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owner/admin can delete members" ON public.organization_members FOR DELETE USING ((( SELECT organization_members_1.role
   FROM public.organization_members organization_members_1
  WHERE ((organization_members_1.org_id = organization_members_1.org_id) AND (organization_members_1.user_id = auth.uid()))) = ANY (ARRAY['owner'::public.member_role, 'admin'::public.member_role])));


--
-- Name: organization_members Owner/admin can insert members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owner/admin can insert members" ON public.organization_members FOR INSERT WITH CHECK ((( SELECT organization_members_1.role
   FROM public.organization_members organization_members_1
  WHERE ((organization_members_1.org_id = organization_members_1.org_id) AND (organization_members_1.user_id = auth.uid()))) = ANY (ARRAY['owner'::public.member_role, 'admin'::public.member_role])));


--
-- Name: org_invite_links Owner/admin can manage invite links; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owner/admin can manage invite links" ON public.org_invite_links USING ((( SELECT organization_members.role
   FROM public.organization_members
  WHERE ((organization_members.org_id = org_invite_links.org_id) AND (organization_members.user_id = auth.uid()))) = ANY (ARRAY['owner'::public.member_role, 'admin'::public.member_role])));


--
-- Name: org_positions Owner/admin can manage positions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owner/admin can manage positions" ON public.org_positions USING ((EXISTS ( SELECT 1
   FROM public.organization_members
  WHERE ((organization_members.org_id = org_positions.org_id) AND (organization_members.user_id = auth.uid()) AND (organization_members.role = ANY (ARRAY['owner'::public.member_role, 'admin'::public.member_role]))))));


--
-- Name: organization_members Owner/admin can update members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owner/admin can update members" ON public.organization_members FOR UPDATE USING ((( SELECT organization_members_1.role
   FROM public.organization_members organization_members_1
  WHERE ((organization_members_1.org_id = organization_members_1.org_id) AND (organization_members_1.user_id = auth.uid()))) = ANY (ARRAY['owner'::public.member_role, 'admin'::public.member_role])));


--
-- Name: organizations Owner/admin can update org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owner/admin can update org" ON public.organizations FOR UPDATE USING ((public.org_member_role(id) = ANY (ARRAY['owner'::public.member_role, 'admin'::public.member_role])));


--
-- Name: organization_members Users can insert themselves as member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert themselves as member" ON public.organization_members FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: profiles Users can update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING ((id = auth.uid()));


--
-- Name: profiles Users can view own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING ((id = auth.uid()));


--
-- Name: activities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

--
-- Name: activity_assignees; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activity_assignees ENABLE ROW LEVEL SECURITY;

--
-- Name: activity_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activity_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: activity_field_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activity_field_history ENABLE ROW LEVEL SECURITY;

--
-- Name: activity_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activity_history ENABLE ROW LEVEL SECURITY;

--
-- Name: activity_status_assignees; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activity_status_assignees ENABLE ROW LEVEL SECURITY;

--
-- Name: campaigns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

--
-- Name: document_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_members ENABLE ROW LEVEL SECURITY;

--
-- Name: documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

--
-- Name: invitations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

--
-- Name: org_settings members can view org settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can view org settings" ON public.org_settings FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.organization_members
  WHERE ((organization_members.org_id = org_settings.org_id) AND (organization_members.user_id = auth.uid())))));


--
-- Name: activity_field_history members view activity field history; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members view activity field history" ON public.activity_field_history FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (((public.activities a
     JOIN public.campaigns c ON ((c.id = a.campaign_id)))
     JOIN public.workspaces w ON ((w.id = c.workspace_id)))
     JOIN public.organization_members om ON ((om.org_id = w.org_id)))
  WHERE ((a.id = activity_field_history.activity_id) AND (om.user_id = auth.uid())))));


--
-- Name: visual_boards org members can delete boards; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can delete boards" ON public.visual_boards FOR DELETE USING (public.is_org_member(org_id));


--
-- Name: visual_boards org members can insert boards; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can insert boards" ON public.visual_boards FOR INSERT WITH CHECK ((public.is_org_member(org_id) AND (auth.uid() = created_by)));


--
-- Name: visual_boards org members can update boards; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can update boards" ON public.visual_boards FOR UPDATE USING (public.is_org_member(org_id));


--
-- Name: visual_boards org members can view boards; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can view boards" ON public.visual_boards FOR SELECT USING (public.is_org_member(org_id));


--
-- Name: org_invite_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.org_invite_links ENABLE ROW LEVEL SECURITY;

--
-- Name: org_positions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.org_positions ENABLE ROW LEVEL SECURITY;

--
-- Name: org_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.org_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: visual_boards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.visual_boards ENABLE ROW LEVEL SECURITY;

--
-- Name: workspaces; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict kBYW5UjBCpYJKKe8owhlOwYXPOMf31A3y50q1yi6QnhkGg9t65MZDSy7Nfh7Q3b

