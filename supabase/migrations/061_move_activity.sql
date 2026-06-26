-- 061_move_activity.sql
-- Mover tarefa para outro projeto (campanha), inclusive de outro cliente da MESMA org.
-- A pasta do Drive é reparentada pelo app (server action moveActivity) — aqui só o vínculo
-- no banco. Idempotente.
create or replace function move_activity(p_user_id uuid, p_activity_id uuid, p_new_campaign_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_new_org uuid;
begin
  -- org da tarefa atual
  select w.org_id into v_org
  from activities a
  join campaigns c on c.id = a.campaign_id
  join workspaces w on w.id = c.workspace_id
  where a.id = p_activity_id;
  if v_org is null then raise exception 'Tarefa não encontrada'; end if;

  -- org do projeto destino (precisa ser a mesma org)
  select w.org_id into v_new_org
  from campaigns c join workspaces w on w.id = c.workspace_id
  where c.id = p_new_campaign_id;
  if v_new_org is null then raise exception 'Projeto destino não encontrado'; end if;
  if v_new_org <> v_org then raise exception 'Projeto destino é de outra organização'; end if;

  -- permissão: membro da org (mesma regra de quem edita a tarefa)
  if not exists (select 1 from organization_members where org_id = v_org and user_id = p_user_id) then
    raise exception 'Acesso negado';
  end if;

  update activities set campaign_id = p_new_campaign_id, updated_at = now() where id = p_activity_id;
end; $$;

grant execute on function move_activity(uuid, uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
