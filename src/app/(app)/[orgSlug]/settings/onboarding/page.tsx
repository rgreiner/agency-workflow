import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { OnboardingConfigClient } from './OnboardingConfigClient'
import type { EtapaConfig } from '@/app/actions/onboarding'

export const dynamic = 'force-dynamic'

export default async function OnboardingSettingsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) notFound()

  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) notFound()

  const { data: me } = await supabase
    .from('organization_members').select('role').eq('org_id', org.id).eq('user_id', user.id).single()
  if (!['owner', 'admin'].includes(me?.role ?? '')) notFound()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: etapasRaw } = await (supabase as any)
    .from('onboarding_etapa')
    .select('id, ordem, titulo, descricao, link, link_label, position_ids, ativo')
    .eq('org_id', org.id)
    .order('ordem', { ascending: true })

  const { data: positions } = await supabase
    .from('org_positions').select('id, name').eq('org_id', org.id).order('name')

  return (
    <OnboardingConfigClient
      orgSlug={orgSlug}
      etapas={(etapasRaw ?? []) as EtapaConfig[]}
      cargos={(positions ?? []) as { id: string; name: string }[]}
    />
  )
}
