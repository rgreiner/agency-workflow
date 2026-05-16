-- Allow org members to view each other's profiles.
-- The existing "Users can view own profile" policy only allows seeing one's own
-- profile, so the members page join returns null for every other member.

CREATE POLICY "Org members can view coworker profiles" ON profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM organization_members om1
      JOIN organization_members om2 ON om1.org_id = om2.org_id
      WHERE om1.user_id = profiles.id
        AND om2.user_id = auth.uid()
    )
  );
