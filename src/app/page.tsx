import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'

export default async function HomePage() {
  const supabase = await createClient()
  const user = await getUsuario()

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
