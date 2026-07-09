-- 082_member_avatar.sql
-- Admin pode trocar o avatar de um membro da org (tela Membros). De quebra,
-- REAFIRMA a update_profile de 4 args (034) — idempotente; se alguma base
-- ficou na versão de 2 args, isto conserta o salvar do perfil. Idempotente.

-- Garante as colunas do perfil (no-op onde a 034 já rodou).
alter table profiles add column if not exists drive_mac_user     text;
alter table profiles add column if not exists drive_google_email text;

drop function if exists update_profile(text, text);
create or replace function update_profile(
  p_full_name          text,
  p_avatar_url         text,
  p_drive_mac_user     text default null,
  p_drive_google_email text default null
)
returns void language plpgsql security definer set search_path = public as $$
begin
  update profiles
  set full_name          = p_full_name,
      avatar_url         = p_avatar_url,
      drive_mac_user     = p_drive_mac_user,
      drive_google_email = p_drive_google_email,
      updated_at         = now()
  where id = auth.uid();
end;
$$;
grant execute on function update_profile(text, text, text, text) to authenticated;

-- Admin/owner troca o avatar de um membro da MESMA org.
create or replace function set_member_avatar(
  p_user_id    uuid,
  p_org_id     uuid,
  p_target     uuid,
  p_avatar_url text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
  select role into v_role
  from organization_members
  where org_id = p_org_id and user_id = p_user_id;

  if v_role not in ('owner', 'admin') then
    raise exception 'Apenas administradores podem alterar o avatar de membros';
  end if;

  if not exists (
    select 1 from organization_members where org_id = p_org_id and user_id = p_target
  ) then
    raise exception 'Pessoa não é membro desta organização';
  end if;

  update profiles set avatar_url = p_avatar_url, updated_at = now() where id = p_target;
end;
$$;
grant execute on function set_member_avatar(uuid, uuid, uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
