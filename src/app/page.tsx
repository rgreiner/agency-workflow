import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: membership } = await supabase
    .from('organization_members')
    .select('organizations(slug)')
    .eq('user_id', user.id)
    .limit(1)
    .single()

  if (membership?.organizations) {
    const org = membership.organizations as { slug: string }
    redirect(`/${org.slug}/dashboard`)
  }

  redirect('/onboarding')
}
