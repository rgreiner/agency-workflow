-- 253_criar_tarefa_exige_responsavel.sql
-- Reversão da decisão da migration 188 ("quem cria é o responsável").
--
-- Na prática o auto-assign poluía: o atendimento (ou o Rafael) criava a tarefa
-- e ficava marcado como responsável de um trabalho que não é dele — e ninguém
-- notava que a informação de dono nunca foi dada. Decisão do Rafael (24/08):
-- responsável é informação EXPLÍCITA na criação. As telas manuais (form "Nova
-- atividade" e o "+ Tarefa" inline da Lista) passam a exigir a escolha; os
-- caminhos em lote (sync do Drive, import de specs), que não têm como saber o
-- dono, criam SEM responsável — e a tarefa cai na fila "Sem responsável" que
-- já existe (card da Gestão, filtro da Lista, grupo do Gantt), que é a marca
-- de "falta essa informação". Melhor marcada como órfã do que com dono errado.
--
-- A RPC ganha `p_assignees uuid[]`: insere só quem é membro ATIVO da org da
-- campanha (arquivado não recebe tarefa nova). Sem fallback pro criador.
-- O gatilho notify_assignee já ignora auto-atribuição e passa a avisar quem
-- foi escolhido por outra pessoa na criação — comportamento desejado.
--
-- PostgREST é estrito com overloads: DROP da assinatura antiga antes de criar
-- a nova (senão ficariam duas create_activity e toda chamada falharia).
--
-- Idempotente.

drop function if exists public.create_activity(
  uuid, uuid, text, text, text, text, text, date, numeric, date);
drop function if exists public.create_activity(
  uuid, uuid, text, text, text, text, text, date, numeric, date, uuid[]);

create function public.create_activity(
  p_user_id uuid, p_campaign_id uuid, p_title text, p_description text default ''::text,
  p_status text default 'briefing'::text, p_priority text default 'medium'::text,
  p_complexity text default 'medium'::text, p_due_date date default null,
  p_estimated_hours numeric default null, p_start_date date default null,
  p_assignees uuid[] default null
) returns uuid language plpgsql security definer set search_path to 'public' as $$
DECLARE
  v_id uuid;
  v_org_id uuid;
BEGIN
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  -- Verifica se o usuário tem acesso à campanha (e resolve a org de uma vez)
  SELECT w.org_id INTO v_org_id
  FROM campaigns c
  JOIN workspaces w ON w.id = c.workspace_id
  JOIN organization_members m ON m.org_id = w.org_id
  WHERE c.id = p_campaign_id AND m.user_id = p_user_id AND m.arquivado = false;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  INSERT INTO activities (
    campaign_id, title, description, status,
    priority, complexity, due_date, estimated_hours,
    start_date, created_by
  ) VALUES (
    p_campaign_id, p_title, p_description, p_status::text,
    p_priority::activity_priority, p_complexity::activity_complexity,
    p_due_date, p_estimated_hours, p_start_date, p_user_id
  )
  RETURNING id INTO v_id;

  -- Responsáveis explícitos (só membro ativo da org). Sem fallback pro criador:
  -- quem cria sem informar dono cria uma tarefa órfã, e órfã fica MARCADA.
  INSERT INTO activity_assignees (activity_id, user_id)
  SELECT DISTINCT v_id, u
  FROM unnest(coalesce(p_assignees, '{}'::uuid[])) AS u
  WHERE EXISTS (
    SELECT 1 FROM organization_members m
    WHERE m.org_id = v_org_id AND m.user_id = u AND m.arquivado = false
  )
  ON CONFLICT DO NOTHING;

  -- Registra no histórico
  INSERT INTO activity_history (activity_id, changed_by, to_status)
  VALUES (v_id, p_user_id, p_status::text);

  RETURN v_id;
END;
$$;

revoke execute on function public.create_activity(
  uuid, uuid, text, text, text, text, text, date, numeric, date, uuid[]) from public, anon;
grant execute on function public.create_activity(
  uuid, uuid, text, text, text, text, text, date, numeric, date, uuid[]) to authenticated;

notify pgrst, 'reload schema';
