-- 052_activity_extra_links.sql
-- Links livres rotulados no job ("Mídia"): planejamento, pasta de boletos,
-- relatórios mensais, etc. Array jsonb [{label, url}]. Idempotente.

alter table activities add column if not exists extra_links jsonb not null default '[]'::jsonb;

create or replace function set_activity_extra_links(p_user_id uuid, p_activity_id uuid, p_links jsonb)
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
     set extra_links = coalesce(p_links, '[]'::jsonb), updated_at = now()
   where id = p_activity_id;
end; $$;

grant execute on function set_activity_extra_links(uuid, uuid, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
