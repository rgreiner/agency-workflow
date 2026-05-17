import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// TEMPORARY — remove after debugging members visibility issue
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'not authenticated' }, { status: 401 })
  }

  // 1. Raw organization_members (no joins)
  const { data: rawMembers, error: rawError } = await supabase
    .from('organization_members')
    .select('id, org_id, user_id, role, joined_at')

  // 2. Same query the members page uses
  const { data: membersWithProfiles, error: joinError } = await supabase
    .from('organization_members')
    .select('id, role, position_id, profiles(id, full_name, email), org_positions(id, name)')

  // 3. Profiles visible to this user
  const { data: visibleProfiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, email, full_name')

  const result = {
    auth_uid: user.id,
    raw_members: { data: rawMembers, error: rawError?.message },
    members_with_profiles: { data: membersWithProfiles, error: joinError?.message },
    visible_profiles: { data: visibleProfiles, error: profilesError?.message },
  }

  return new NextResponse(
    `<pre style="font-size:13px;padding:16px;white-space:pre-wrap">${JSON.stringify(result, null, 2)}</pre>`,
    { headers: { 'Content-Type': 'text/html' } }
  )
}
