import { redirect } from 'next/navigation'
import { getAccess } from '@/lib/auth/access'
import { carregarTrilha } from '@/app/actions/onboarding'
import { OnboardingClient } from './OnboardingClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Primeiros passos — Flow' }

export default async function OnboardingPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const acc = await getAccess(orgSlug)
  if (!acc) redirect('/')

  const r = await carregarTrilha(orgSlug)
  const trilha = ('trilha' in r ? r.trilha : []) ?? []

  return <OnboardingClient orgSlug={orgSlug} trilha={trilha} isAdmin={acc.access.isOwner || acc.access.verTudo} />
}
