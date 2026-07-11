-- 089_lembrete_prazo.sql
-- Lembrete de prazo: cria uma notificação in-app (tipo 'due_soon') pro responsável
-- das tarefas que VENCEM AMANHÃ (data de Brasília), ativas. Chamado 1x/dia pelo cron.
-- Dedup: não repete se já avisou nas últimas 20h. Idempotente.

create or replace function notify_due_soon()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count int := 0; v_tomorrow date;
begin
  v_tomorrow := (now() at time zone 'America/Sao_Paulo')::date + 1;
  insert into notifications (user_id, org_id, type, activity_id, actor_id, data)
  select distinct aa.user_id, w.org_id, 'due_soon', a.id, null::uuid,
         jsonb_build_object('due', a.due_date::text)
  from activity_assignees aa
  join activities a on a.id = aa.activity_id
  join campaigns  c on c.id = a.campaign_id
  join workspaces w on w.id = c.workspace_id
  where a.archived = false and a.status <> 'concluido' and a.due_date = v_tomorrow
    and not exists (
      select 1 from notifications n
      where n.user_id = aa.user_id and n.activity_id = a.id and n.type = 'due_soon'
        and n.created_at > now() - interval '20 hours'
    );
  get diagnostics v_count = row_count;
  return v_count;
end; $$;
grant execute on function notify_due_soon() to anon, authenticated;

notify pgrst, 'reload schema';
