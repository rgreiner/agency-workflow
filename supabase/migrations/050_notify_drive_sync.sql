-- 050_notify_drive_sync.sql
-- Notificação "drive_sync" (de campanha) quando se vincula a pasta do Drive:
-- aparece na Caixa de entrada e, ao clicar, abre a sincronização da campanha
-- pra escolher o que criar/vincular. Idempotente.

create or replace function notify_drive_sync(p_user_id uuid, p_campaign_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_ws uuid; v_name text;
begin
  select w.org_id, c.workspace_id, c.name
    into v_org, v_ws, v_name
    from campaigns c join workspaces w on w.id = c.workspace_id
    where c.id = p_campaign_id;
  if v_org is null then return; end if;

  insert into notifications (user_id, org_id, type, activity_id, actor_id, data)
  values (
    p_user_id, v_org, 'drive_sync', null, p_user_id,
    jsonb_build_object('campaignId', p_campaign_id::text, 'workspaceId', v_ws::text, 'campanha', v_name)
  );
end; $$;

grant execute on function notify_drive_sync(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
