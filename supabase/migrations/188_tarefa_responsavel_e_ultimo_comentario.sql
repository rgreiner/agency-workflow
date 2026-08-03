-- 188_tarefa_responsavel_e_ultimo_comentario.sql
-- Auditoria 02/08 — Operacional e pauta, dois achados.
--
-- 1) "Tarefa nasce sempre sem responsável". O form não tem campo de responsável e
--    a RPC não recebe nenhum, então atribuir era sempre um segundo passo — e a
--    fila "sem responsável" (8 hoje) nasce daí. Decisão do Rafael: quem cria a
--    tarefa fica como responsável dela. Fica na RPC, não na action, pra valer em
--    TODO caminho de criação (form, criação inline na Lista, sync do Drive,
--    import de specs) — quem importa em lote também é quem responde por elas até
--    distribuir, e ter dono é melhor que não ter.
--
--    Junto vem um ajuste no gatilho de notificação: `notify_assignee` avisava
--    QUALQUER pessoa atribuída, inclusive quem se atribuiu. Sem isso, criar uma
--    tarefa passaria a gerar um "você foi atribuído" da própria pessoa — e um
--    import de 50 specs geraria 50.
--
-- 2) "A Lista baixa todos os comentários de todas as tarefas a cada abertura":
--    lib/activity-list.ts fazia um select sem limite só pra ficar com o primeiro
--    de cada atividade. São 490 comentários hoje pra devolver 111 linhas úteis, e
--    cresce sem teto. `distinct on (activity_id)` devolve exatamente uma linha por
--    tarefa. A função é INVOKER de propósito (sem security definer): assim a RLS
--    de activity_comments continua valendo, que é o mesmo que valia na query direta.
--
-- Idempotente.

-- ── 1) Quem cria é o responsável ────────────────────────────────────────────
create or replace function create_activity(
  p_user_id uuid, p_campaign_id uuid, p_title text, p_description text default ''::text,
  p_status text default 'briefing'::text, p_priority text default 'medium'::text,
  p_complexity text default 'medium'::text, p_due_date date default null,
  p_estimated_hours numeric default null, p_start_date date default null
) returns uuid language plpgsql security definer set search_path to 'public' as $$
DECLARE
  v_id uuid;
BEGIN
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  -- Verifica se o usuário tem acesso à campanha
  IF NOT EXISTS (
    SELECT 1 FROM campaigns c
    JOIN workspaces w ON w.id = c.workspace_id
    JOIN organization_members m ON m.org_id = w.org_id
    WHERE c.id = p_campaign_id AND m.user_id = p_user_id AND m.arquivado = false
  ) THEN
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

  -- Responsável inicial = quem criou. Trocar depois é um clique no seletor;
  -- o que não pode é a tarefa nascer órfã e ficar esperando alguém notar.
  INSERT INTO activity_assignees (activity_id, user_id)
  VALUES (v_id, p_user_id)
  ON CONFLICT DO NOTHING;

  -- Registra no histórico
  INSERT INTO activity_history (activity_id, changed_by, to_status)
  VALUES (v_id, p_user_id, p_status::text);

  RETURN v_id;
END;
$$;

-- ── Não avisar quem se atribuiu ─────────────────────────────────────────────
create or replace function notify_assignee()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid;
begin
  -- Atribuir a si mesmo não é aviso: a pessoa acabou de fazer isso.
  if NEW.user_id = auth.uid() then return NEW; end if;

  select w.org_id into v_org
  from activities a
  join campaigns c on c.id = a.campaign_id
  join workspaces w on w.id = c.workspace_id
  where a.id = NEW.activity_id;
  if v_org is null then return NEW; end if;

  insert into notifications (user_id, org_id, type, activity_id, actor_id, data)
  values (NEW.user_id, v_org, 'assigned', NEW.activity_id, auth.uid(), '{}'::jsonb);
  return NEW;
end; $$;

-- ── 2) Último comentário por tarefa, em uma linha cada ──────────────────────
create index if not exists idx_activity_comments_atividade_data
  on activity_comments (activity_id, created_at desc);

create or replace function activity_last_comments(p_ids uuid[])
returns table(activity_id uuid, content text, created_at timestamptz, author text)
language sql stable set search_path to 'public' as $$
  select distinct on (c.activity_id)
         c.activity_id, c.content, c.created_at, p.full_name
  from activity_comments c
  left join profiles p on p.id = c.user_id
  where c.activity_id = any(p_ids)
  order by c.activity_id, c.created_at desc;
$$;
revoke execute on function activity_last_comments(uuid[]) from public, anon;
grant execute on function activity_last_comments(uuid[]) to authenticated;

notify pgrst, 'reload schema';
