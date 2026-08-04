import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'

export default async function HomePage() {
  const supabase = await createClient()
  const user = await getUsuario()

  if (!user) {
    redirect('/login')
  }

  // Vínculo ARQUIVADO não conta: quem saiu da agência não é levado para dentro do
  // ambiente dela. Os portões do banco (is_org_member, rh_can) já barravam o dado, mas
  // a casca do app abria assim mesmo — e o heartbeat do chat marcava a pessoa online.
  const { data: membership } = await supabase
    .from('organization_members')
    .select('organizations(slug)')
    .eq('user_id', user.id)
    .eq('arquivado', false)
    .limit(1)
    .maybeSingle()

  if (membership?.organizations) {
    const org = membership.organizations as { slug: string }
    redirect(`/${org.slug}/dashboard`)
  }

  redirect('/onboarding')
}
