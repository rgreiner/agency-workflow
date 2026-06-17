-- Caixa de entrada (notificações). Populada por gatilhos no banco.
-- Idempotente.

create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,       -- destinatário
  org_id      uuid not null references organizations(id) on delete cascade,
  type        text not null,        -- status_change | entered_status | new_comment | assigned
  activity_id uuid references activities(id) on delete cascade,
  actor_id    uuid references profiles(id) on delete set null,               -- quem causou
  data        jsonb not null default '{}',
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_notifications_user on notifications(user_id, created_at desc);
create index if not exists idx_notifications_unread on notifications(user_id) where read_at is null;

alter table notifications enable row level security;
drop policy if exists "notif own select" on notifications;
drop policy if exists "notif own update" on notifications;
create policy "notif own select" on notifications for select using (user_id = auth.uid());
create policy "notif own update" on notifications for update using (user_id = auth.uid());
grant select, update on notifications to anon, authenticated;

-- Org de uma atividade (helper inline nos gatilhos via join).

-- ── Status mudou (dispara em activity_history) ──────────────────────────────
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

  -- criador + responsáveis da tarefa
  insert into notifications (user_id, org_id, type, activity_id, actor_id, data)
  select distinct u, v_org, 'status_change', NEW.activity_id, NEW.changed_by,
         jsonb_build_object('from', NEW.from_status, 'to', NEW.to_status)
  from (
    select v_creator as u
    union
    select user_id from activity_assignees where activity_id = NEW.activity_id
  ) r
  where u is not null and u is distinct from NEW.changed_by;

  -- responsáveis pelo NOVO status (por cargo) — "entrou tarefa para você"
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

  return NEW;
end; $$;

drop trigger if exists trg_notify_status_change on activity_history;
create trigger trg_notify_status_change after insert on activity_history
  for each row execute function notify_status_change();

-- ── Novo comentário (dispara em activity_comments) → avisa o criador ────────
create or replace function notify_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_creator uuid;
begin
  select w.org_id, a.created_by into v_org, v_creator
  from activities a
  join campaigns c on c.id = a.campaign_id
  join workspaces w on w.id = c.workspace_id
  where a.id = NEW.activity_id;
  if v_org is null then return NEW; end if;

  if v_creator is not null and v_creator is distinct from NEW.user_id then
    insert into notifications (user_id, org_id, type, activity_id, actor_id, data)
    values (v_creator, v_org, 'new_comment', NEW.activity_id, NEW.user_id,
            jsonb_build_object('preview', left(NEW.content, 120)));
  end if;
  return NEW;
end; $$;

drop trigger if exists trg_notify_comment on activity_comments;
create trigger trg_notify_comment after insert on activity_comments
  for each row execute function notify_comment();

-- ── Associado a uma tarefa (dispara em activity_assignees) ──────────────────
create or replace function notify_assignee() returns trigger
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
  values (NEW.user_id, v_org, 'assigned', NEW.activity_id, null, '{}'::jsonb);
  return NEW;
end; $$;

drop trigger if exists trg_notify_assignee on activity_assignees;
create trigger trg_notify_assignee after insert on activity_assignees
  for each row execute function notify_assignee();

notify pgrst, 'reload schema';
