-- Mover projeto (campanha/job) para outro cliente.
--
-- Job criado no cliente errado só se corrigia tarefa por tarefa (move_activity
-- já atravessa clientes); o projeto em si ficava preso ao cliente de origem.
-- Caso real (13/10/2026): "Fazenda Morada Do Boi" nasceu em Jobs e foi
-- incorporado pelo É O Amor.
--
-- O que vai junto: as tarefas (pela campanha), reuniões e briefings do projeto
-- (têm workspace_id próprio e precisam acompanhar).
-- O que BLOQUEIA: PP/PI/MX e rotinas de mídia ligadas ao projeto. Documento
-- comercial tem o cliente como parte — trocar o cliente dele por baixo mexeria em
-- faturamento e lançamento já feitos. Medido: producao/midias.workspace_id bate
-- com o da campanha em 100% das linhas, e é isso que se preserva.

create or replace function move_campaign(p_user_id uuid, p_campaign_id uuid, p_new_workspace_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_old_ws uuid; v_new_org uuid; v_docs int;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  select w.org_id, c.workspace_id into v_org, v_old_ws
  from campaigns c join workspaces w on w.id = c.workspace_id
  where c.id = p_campaign_id;
  if v_org is null then raise exception 'Projeto não encontrado'; end if;

  select org_id into v_new_org from workspaces where id = p_new_workspace_id;
  if v_new_org is null then raise exception 'Cliente destino não encontrado'; end if;
  if v_new_org <> v_org then raise exception 'Cliente destino é de outra organização'; end if;
  if v_old_ws = p_new_workspace_id then return; end if;

  -- Mesma régua de quem edita o projeto (update_campaign).
  if not exists (select 1 from organization_members where org_id = v_org and user_id = p_user_id
      and role in ('owner','admin','manager')) then
    raise exception 'Acesso negado';
  end if;

  select (select count(*) from producao where campaign_id = p_campaign_id)
       + (select count(*) from midias where campaign_id = p_campaign_id)
       + (select count(*) from midia_cliente where campaign_id = p_campaign_id)
       + (select count(*) from midia_entrega where campaign_id = p_campaign_id)
    into v_docs;
  if v_docs > 0 then
    raise exception 'Este projeto tem % documento(s) de produção/mídia (PP, PI, MX ou rotina). O cliente desses documentos não muda por aqui: mova as tarefas para um projeto do outro cliente.', v_docs;
  end if;

  update campaigns set workspace_id = p_new_workspace_id, updated_at = now() where id = p_campaign_id;
  update reunioes  set workspace_id = p_new_workspace_id where campaign_id = p_campaign_id;
  update documents set workspace_id = p_new_workspace_id where briefing_campaign_id = p_campaign_id;
end $$;

revoke execute on function move_campaign(uuid, uuid, uuid) from public, anon;
grant execute on function move_campaign(uuid, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
