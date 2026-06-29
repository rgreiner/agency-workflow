-- 069_notif_monitored_cast.sql
-- Fix: na 068, comparávamos NEW.to_status (enum activity_status) com um array de
-- TEXTO (v_monitorados) → "operator does not exist: activity_status = text", o
-- que abortava a mudança de status. Castamos NEW.to_status::text. Idempotente.

create or replace function notify_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_creator uuid;
  v_monitorados text[] := array['revisao_interna','validacao_midia'];
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
    and aa.user_id is distinct from v_creator;

  -- (3) Status MONITORADOS: quem tem o cargo recebe mesmo sem ser responsável.
  --     Cast p/ text — v_monitorados é text[] e to_status é enum activity_status.
  if NEW.to_status::text = any(v_monitorados) then
    insert into notifications (user_id, org_id, type, activity_id, actor_id, data)
    select distinct om.user_id, v_org, 'entered_status', NEW.activity_id, NEW.changed_by,
           jsonb_build_object('to', NEW.to_status)
    from organization_members om
    join org_positions pos on pos.id = om.position_id
    where om.org_id = v_org
      and NEW.to_status = any(pos.allowed_statuses)
      and om.user_id is distinct from NEW.changed_by
      and om.user_id is distinct from v_creator
      and om.user_id not in (select user_id from activity_assignees where activity_id = NEW.activity_id);
  end if;

  return NEW;
end; $$;

notify pgrst, 'reload schema';
