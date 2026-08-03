import { assertRhAccess } from '@/lib/rh'
import { hojeBRT } from '@/lib/hoje'
import { EspelhoListaClient } from './EspelhoListaClient'

export const dynamic = 'force-dynamic'

export default async function EspelhoListaPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  await assertRhAccess(orgSlug)
  return <EspelhoListaClient orgSlug={orgSlug} compInicial={hojeBRT().slice(0, 7)} />
}
