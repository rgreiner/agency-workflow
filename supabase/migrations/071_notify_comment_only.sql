-- 071_notify_comment_only.sql
-- Redefine APENAS notify_comment (avisar quem já comentou na tarefa).
-- Isolado de propósito: a 067 redefinia também o notify_status_change numa versão
-- antiga (sem os status monitorados), então reaplicá-la reverteria a 069/070.
-- Esta migration NÃO toca notify_status_change. Idempotente.

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

  -- Avisa quem JÁ comentou nesta tarefa (participantes), exceto o autor.
  insert into notifications (user_id, org_id, type, activity_id, actor_id, data)
  select distinct ac.user_id, v_org, 'new_comment', NEW.activity_id, NEW.user_id,
         jsonb_build_object('preview', left(NEW.content, 120))
  from activity_comments ac
  where ac.activity_id = NEW.activity_id
    and ac.user_id is distinct from NEW.user_id;

  return NEW;
end; $$;

notify pgrst, 'reload schema';
