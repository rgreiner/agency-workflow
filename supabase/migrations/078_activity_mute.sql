-- 078_activity_mute.sql
-- "Silenciar tarefa pra mim": para de receber notificação de MUDANÇA DE STATUS
-- dessa tarefa. Comentário e @menção continuam avisando (não são tocados).
-- Idempotente.

create table if not exists activity_mutes (
  user_id     uuid not null references profiles(id) on delete cascade,
  activity_id uuid not null references activities(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, activity_id)
);

alter table activity_mutes enable row level security;

drop policy if exists "own mutes select" on activity_mutes;
create policy "own mutes select" on activity_mutes for select using (user_id = auth.uid());

-- Liga/desliga o silêncio (só o próprio usuário).
create or replace function set_activity_mute(p_user_id uuid, p_activity_id uuid, p_muted boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- precisa ser membro da org da tarefa
  if not exists (
    select 1 from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    join organization_members om on om.org_id = w.org_id
    where a.id = p_activity_id and om.user_id = p_user_id
  ) then raise exception 'Acesso negado'; end if;

  if p_muted then
    insert into activity_mutes (user_id, activity_id) values (p_user_id, p_activity_id)
      on conflict do nothing;
  else
    delete from activity_mutes where user_id = p_user_id and activity_id = p_activity_id;
  end if;
end; $$;

grant execute on function set_activity_mute(uuid,uuid,boolean) to anon, authenticated;

-- Redefine notify_status_change: mesmos 3 blocos da 070, mas pulando quem
-- silenciou a tarefa (activity_mutes).
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

  -- (1) Criador acompanha toda mudança de status (salvo se silenciou)
  if v_creator is not null and v_creator is distinct from NEW.changed_by
     and not exists (select 1 from activity_mutes m where m.activity_id = NEW.activity_id and m.user_id = v_creator) then
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
    and aa.user_id is distinct from v_creator
    and not exists (select 1 from activity_mutes m where m.activity_id = NEW.activity_id and m.user_id = aa.user_id);

  -- (3) Status MONITORADOS: quem tem o cargo recebe mesmo sem ser responsável
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
      and not exists (
        select 1 from activity_assignees aa
        where aa.activity_id = NEW.activity_id and aa.user_id = om.user_id
      )
      and not exists (select 1 from activity_mutes m where m.activity_id = NEW.activity_id and m.user_id = om.user_id);
  end if;

  return NEW;
end; $$;

notify pgrst, 'reload schema';
