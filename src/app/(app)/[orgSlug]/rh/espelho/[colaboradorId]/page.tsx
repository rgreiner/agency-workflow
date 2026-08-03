import { assertRhAccess } from '@/lib/rh'
import { hojeBRT } from '@/lib/hoje'
import { EspelhoClient } from './EspelhoClient'

export const dynamic = 'force-dynamic'

export default async function EspelhoPage({ params, searchParams }: {
  params: Promise<{ orgSlug: string; colaboradorId: string }>
  searchParams: Promise<{ comp?: string }>
}) {
  const { orgSlug, colaboradorId } = await params
  const { comp } = await searchParams
  await assertRhAccess(orgSlug)
  const competencia = comp && /^\d{4}-\d{2}$/.test(comp) ? comp : hojeBRT().slice(0, 7)
  return <EspelhoClient orgSlug={orgSlug} colaboradorId={colaboradorId} compInicial={competencia} />
}
