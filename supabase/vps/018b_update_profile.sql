-- ════════════════════════════════════════════════════════════════════
-- 018 minus storage — run IN PLACE OF 018_profile_and_avatars.sql
-- ════════════════════════════════════════════════════════════════════
-- The original 018 created the Supabase `avatars` storage bucket + RLS on
-- storage.objects (skipped on VPS — avatars are handled by our own storage
-- in the app). The ONLY non-storage piece is the update_profile() RPC, kept
-- verbatim below.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_profile(
  p_full_name  text,
  p_avatar_url text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE profiles
  SET full_name  = p_full_name,
      avatar_url = p_avatar_url,
      updated_at = now()
  WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION update_profile(text, text) TO authenticated;
