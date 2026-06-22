-- Menções em comentários (@pessoa / @todos). Insere o comentário (o gatilho de
-- comentário continua avisando o criador) e cria notificações tipo 'mention'
-- para as pessoas marcadas — ou para toda a org, se p_mention_all.
create or replace function add_comment_with_mentions(
  p_user_id     uuid,
  p_activity_id uuid,
  p_content     text,
  p_mention_ids uuid[]  default '{}',
  p_mention_all boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_org uuid;
begin
  -- permissão + org da atividade
  select w.org_id into v_org
  from activities a
  join campaigns c on c.id = a.campaign_id
  join workspaces w on w.id = c.workspace_id
  join organization_members m on m.org_id = w.org_id
  where a.id = p_activity_id and m.user_id = p_user_id;
  if v_org is null then raise exception 'Acesso negado'; end if;

  insert into activity_comments (activity_id, user_id, content)
  values (p_activity_id, p_user_id, p_content)
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

grant execute on function add_comment_with_mentions(uuid, uuid, text, uuid[], boolean) to anon, authenticated;

notify pgrst, 'reload schema';
