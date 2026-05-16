-- Allow org members to view each other's profiles.
-- The existing "Users can view own profile" policy only allows seeing one's own
-- profile, so the members page join returns null for every other member.
--
-- Uses a SECURITY DEFINER function so the inner organization_members lookup
-- bypasses RLS, preventing recursive policy evaluation that would cause the
-- parent query to return empty results.

CREATE OR REPLACE FUNCTION is_coworker(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members om1
    JOIN organization_members om2 ON om1.org_id = om2.org_id
    WHERE om1.user_id = p_profile_id AND om2.user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION is_coworker(uuid) TO anon, authenticated;

CREATE POLICY "Org members can view coworker profiles" ON profiles
  FOR SELECT USING (is_coworker(id));
