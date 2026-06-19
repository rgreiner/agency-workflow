-- Integração com o Google Drive: pasta da campanha + pastas/links da tarefa.

alter table campaigns   add column if not exists drive_folder_id  text;
alter table activities  add column if not exists drive_folder_id  text;
alter table activities  add column if not exists drive_path        text;   -- "Caminho na máquina"
alter table activities  add column if not exists preview_url       text;
alter table org_settings add column if not exists drive_path_prefix text;   -- ex.: G:\Drives compartilhados\

-- Vincular pasta do Drive a uma campanha (NULL limpa o vínculo)
create or replace function set_campaign_drive(p_user_id uuid, p_campaign_id uuid, p_drive_folder_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from campaigns c
    join workspaces w on w.id = c.workspace_id
    join organization_members m on m.org_id = w.org_id
    where c.id = p_campaign_id and m.user_id = p_user_id and m.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  update campaigns set drive_folder_id = p_drive_folder_id where id = p_campaign_id;
end; $$;

-- Salvar os campos de Drive da atividade (chamado após criar as pastas)
create or replace function set_activity_drive(
  p_user_id uuid, p_activity_id uuid,
  p_drive_folder_id text, p_drive_path text, p_drive_folder_url text,
  p_redacao_url text, p_finalizacao_url text, p_preview_url text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from activities a
    join campaigns c on c.id = a.campaign_id
    join workspaces w on w.id = c.workspace_id
    join organization_members m on m.org_id = w.org_id
    where a.id = p_activity_id and m.user_id = p_user_id
  ) then raise exception 'Acesso negado'; end if;
  update activities set
    drive_folder_id = coalesce(p_drive_folder_id, drive_folder_id),
    drive_path      = coalesce(p_drive_path, drive_path),
    drive_folder_url = coalesce(p_drive_folder_url, drive_folder_url),
    redacao_url     = coalesce(p_redacao_url, redacao_url),
    finalizacao_url = coalesce(p_finalizacao_url, finalizacao_url),
    preview_url     = coalesce(p_preview_url, preview_url)
  where id = p_activity_id;
end; $$;

grant execute on function set_campaign_drive(uuid, uuid, text) to anon, authenticated;
grant execute on function set_activity_drive(uuid, uuid, text, text, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
