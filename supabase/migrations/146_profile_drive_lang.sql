-- 146_profile_drive_lang.sql
-- Idioma do Drive/Mac por pessoa. O Google Drive Desktop LOCALIZA a raiz das pastas
-- pelo idioma do sistema: "Drives compartilhados"/"Meu Drive" (pt) viram
-- "Shared drives"/"My Drive" (en). Sem isso, o caminho montado pro Mac de quem usa o
-- sistema em inglês aponta pra uma pasta que não existe.
-- Idempotente.

alter table profiles add column if not exists drive_lang text not null default 'pt';

-- update_profile ganha p_drive_lang. PostgREST é estrito com overload → dropa a
-- assinatura antiga (4 args) antes de recriar com 5. Continua usando auth.uid()
-- (seguro, não recebe p_user_id).
drop function if exists update_profile(text, text, text, text);

create or replace function update_profile(
  p_full_name text, p_avatar_url text,
  p_drive_mac_user text default null, p_drive_google_email text default null,
  p_drive_lang text default null
) returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update profiles
  set full_name          = p_full_name,
      avatar_url         = p_avatar_url,
      drive_mac_user     = p_drive_mac_user,
      drive_google_email = p_drive_google_email,
      drive_lang         = coalesce(nullif(p_drive_lang,''), drive_lang),
      updated_at         = now()
  where id = auth.uid();
end; $$;

revoke execute on function update_profile(text,text,text,text,text) from public;
grant execute on function update_profile(text,text,text,text,text) to authenticated;

notify pgrst, 'reload schema';
