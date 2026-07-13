-- 103_activity_checklist.sql
-- Checklist leve dentro da tarefa: sub-passos (texto + feito), sem o peso de
-- subtarefa. Array jsonb [{id, text, done}]. Chip de progresso 3/7 na Lista/Gantt.
-- Idempotente. Segue o padrão do extra_links (052).

alter table activities add column if not exists checklist jsonb not null default '[]'::jsonb;

create or replace function set_activity_checklist(p_user_id uuid, p_activity_id uuid, p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select w.org_id into v_org
  from activities a
  join campaigns c on c.id = a.campaign_id
  join workspaces w on w.id = c.workspace_id
  join organization_members m on m.org_id = w.org_id
  where a.id = p_activity_id and m.user_id = p_user_id;
  if v_org is null then raise exception 'Acesso negado'; end if;

  update activities
     set checklist = coalesce(p_items, '[]'::jsonb), updated_at = now()
   where id = p_activity_id;
end; $$;

grant execute on function set_activity_checklist(uuid, uuid, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
