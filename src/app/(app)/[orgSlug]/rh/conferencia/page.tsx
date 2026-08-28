import { assertRhAccess } from '@/lib/rh'
import { ConferenciaClient } from './ConferenciaClient'

export const dynamic = 'force-dynamic'

export default async function ConferenciaPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  await assertRhAccess(orgSlug)
  return <ConferenciaClient orgSlug={orgSlug} />
}
