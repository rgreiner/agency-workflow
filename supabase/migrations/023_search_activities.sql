-- Busca de atividades sem acento (título + briefing), com opção de incluir arquivadas.
-- Idempotente.

create extension if not exists unaccent;

create or replace function search_activities(
  p_user_id         uuid,
  p_org_id          uuid,
  p_query           text,
  p_include_archived boolean default false
) returns table (
  id             uuid,
  title          text,
  status         text,
  archived       boolean,
  campaign_id    uuid,
  campaign_name  text,
  workspace_id   uuid,
  workspace_name text
)
language sql security definer set search_path = public, extensions
as $$
  select a.id, a.title, a.status::text, a.archived,
         c.id, c.name, w.id, w.name
  from activities a
  join campaigns c on c.id = a.campaign_id
  join workspaces w on w.id = c.workspace_id
  where w.org_id = p_org_id
    -- só membros da org enxergam (segurança, já que é security definer)
    and exists (
      select 1 from organization_members m
      where m.org_id = p_org_id and m.user_id = p_user_id
    )
    and (p_include_archived or not a.archived)
    and (
      unaccent(a.title) ilike '%' || unaccent(p_query) || '%'
      or unaccent(coalesce(a.description, '')) ilike '%' || unaccent(p_query) || '%'
    )
  order by a.archived asc, a.updated_at desc
  limit 12;
$$;

grant execute on function search_activities(uuid, uuid, text, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
