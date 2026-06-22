-- Config do "Caminho na máquina" (Mac) no perfil do usuário. Cada pessoa cadastra
-- uma vez em Meu Perfil; o app converte o caminho Windows para o caminho do Mac.
alter table profiles add column if not exists drive_mac_user     text;
alter table profiles add column if not exists drive_google_email text;

-- Estende update_profile p/ salvar também a config do Mac. Os novos parâmetros têm
-- default null → chamadas antigas (2 args) continuam funcionando.
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

notify pgrst, 'reload schema';
