-- 051_comment_reply_react.sql
-- Responder (citar) + reagir (emoji) em comentários de tarefa. Idempotente.

-- 1) Responder: comentário pode citar outro comentário.
alter table activity_comments add column if not exists reply_to uuid references activity_comments(id) on delete set null;

-- 2) Reações (emoji) por usuário em cada comentário.
create table if not exists activity_comment_reactions (
  id         uuid primary key default gen_random_uuid(),
  comment_id uuid not null references activity_comments(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  unique (comment_id, user_id, emoji)
);
create index if not exists idx_comment_reactions_comment on activity_comment_reactions(comment_id);

alter table activity_comment_reactions enable row level security;
grant select on activity_comment_reactions to anon, authenticated;

drop policy if exists "Org members read reactions" on activity_comment_reactions;
create policy "Org members read reactions" on activity_comment_reactions for select using (
  exists (
    select 1 from activity_comments ac
    join activities a on a.id = ac.activity_id
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    where ac.id = activity_comment_reactions.comment_id and public.is_org_member(w.org_id)
  )
);

-- 3) Toggle de reação (cria/remove). Escrita só via RPC (security definer).
create or replace function toggle_comment_reaction(p_user_id uuid, p_comment_id uuid, p_emoji text)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select w.org_id into v_org
  from activity_comments ac
  join activities a on a.id = ac.activity_id
  join campaigns c on c.id = a.campaign_id
  join workspaces w on w.id = c.workspace_id
  join organization_members m on m.org_id = w.org_id
  where ac.id = p_comment_id and m.user_id = p_user_id;
  if v_org is null then raise exception 'Acesso negado'; end if;

  if exists (select 1 from activity_comment_reactions where comment_id = p_comment_id and user_id = p_user_id and emoji = p_emoji) then
    delete from activity_comment_reactions where comment_id = p_comment_id and user_id = p_user_id and emoji = p_emoji;
  else
    insert into activity_comment_reactions (comment_id, user_id, emoji) values (p_comment_id, p_user_id, p_emoji);
  end if;
end; $$;
grant execute on function toggle_comment_reaction(uuid, uuid, text) to anon, authenticated;

-- 4) add_comment_with_mentions agora aceita reply_to (substitui a versão de 5 args).
drop function if exists add_comment_with_mentions(uuid, uuid, text, uuid[], boolean);
create or replace function add_comment_with_mentions(
  p_user_id     uuid,
  p_activity_id uuid,
  p_content     text,
  p_mention_ids uuid[]  default '{}',
  p_mention_all boolean default false,
  p_reply_to    uuid    default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_org uuid;
begin
  select w.org_id into v_org
  from activities a
  join campaigns c on c.id = a.campaign_id
  join workspaces w on w.id = c.workspace_id
  join organization_members m on m.org_id = w.org_id
  where a.id = p_activity_id and m.user_id = p_user_id;
  if v_org is null then raise exception 'Acesso negado'; end if;

  insert into activity_comments (activity_id, user_id, content, reply_to)
  values (p_activity_id, p_user_id, p_content, p_reply_to)
  returning id into v_id;

  if p_mention_all then
    insert into notifications (user_id, org_id, type, activity_id, actor_id, data)
    select om.user_id, v_org, 'mention', p_activity_id, p_user_id,
           jsonb_build_object('preview', left(p_content, 120), 'all', true)
    from organization_members om
    where om.org_id = v_org and om.user_id is distinct from p_user_id;
  elsif p_mention_ids is not null and array_length(p_mention_ids, 1) > 0 then
    insert into notifications (user_id, org_id, type, activity_id, actor_id, data)
    select distinct uid, v_org, 'mention', p_activity_id, p_user_id,
           jsonb_build_object('preview', left(p_content, 120))
    from unnest(p_mention_ids) uid
    where uid is distinct from p_user_id
      and exists (select 1 from organization_members om where om.org_id = v_org and om.user_id = uid);
  end if;

  return v_id;
end; $$;
grant execute on function add_comment_with_mentions(uuid, uuid, text, uuid[], boolean, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
