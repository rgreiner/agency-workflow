-- 067_notifications_refine.sql
-- Refina a Caixa de entrada — para de notificar "todo mundo do cargo".
-- Regras (Rafael, 2026-06-29):
--  1. Criador: acompanha TODA mudança de status da tarefa.
--  2. Responsável (associado): avisa só quando a tarefa ENTRA num status do
--     cargo dele (não em toda mudança).
--  3. Comentário: avisa quem JÁ interagiu (comentou) na tarefa (participantes).
--  4. Menção: já tratada em add_comment_with_mentions (mantida).
-- 'assigned' (quando te associam) também é mantido. Idempotente.

-- ── Status mudou ────────────────────────────────────────────────────────────
create or replace function notify_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_creator uuid;
begin
  select w.org_id, a.created_by into v_org, v_creator
  from activities a
  join campaigns c on c.id = a.campaign_id
  join workspaces w on w.id = c.workspace_id
  where a.id = NEW.activity_id;
  if v_org is null then return NEW; end if;

  -- (1) Criador acompanha toda mudança de status
  if v_creator is not null and v_creator is distinct from NEW.changed_by then
    insert into notifications (user_id, org_id, type, activity_id, actor_id, data)
    values (v_creator, v_org, 'status_change', NEW.activity_id, NEW.changed_by,
            jsonb_build_object('from', NEW.from_status, 'to', NEW.to_status));
  end if;

  -- (2) Responsável recebe quando ENTRA num status do cargo dele
  insert into notifications (user_id, org_id, type, activity_id, actor_id, data)
  select distinct aa.user_id, v_org, 'entered_status', NEW.activity_id, NEW.changed_by,
         jsonb_build_object('to', NEW.to_status)
  from activity_assignees aa
  join organization_members om on om.org_id = v_org and om.user_id = aa.user_id
  join org_positions pos on pos.id = om.position_id
  where aa.activity_id = NEW.activity_id
    and NEW.to_status = any(pos.allowed_statuses)
    and aa.user_id is distinct from NEW.changed_by
    and aa.user_id is distinct from v_creator;   -- criador já recebeu (1)

  return NEW;
end; $$;

-- ── Novo comentário → avisa participantes (quem já comentou) ─────────────────
create or replace function notify_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select w.org_id into v_org
  from activities a
  join campaigns c on c.id = a.campaign_id
  join workspaces w on w.id = c.workspace_id
  where a.id = NEW.activity_id;
  if v_org is null then return NEW; end if;

  insert into notifications (user_id, org_id, type, activity_id, actor_id, data)
  select distinct ac.user_id, v_org, 'new_comment', NEW.activity_id, NEW.user_id,
         jsonb_build_object('preview', left(NEW.content, 120))
  from activity_comments ac
  where ac.activity_id = NEW.activity_id
    and ac.user_id is distinct from NEW.user_id;   -- não notifica o próprio autor

  return NEW;
end; $$;

notify pgrst, 'reload schema';
