import { assertRhAccess } from '@/lib/rh'
import { hojeBRT } from '@/lib/hoje'
import { AusenciasClient } from './AusenciasClient'

export const dynamic = 'force-dynamic'

export default async function AusenciasPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  await assertRhAccess(orgSlug)
  return <AusenciasClient orgSlug={orgSlug} hoje={hojeBRT()} />
}
