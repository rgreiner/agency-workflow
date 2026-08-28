import { assertFinanceAccess } from '@/lib/finance'
import { hojeBRT } from '@/lib/hoje'
import { MargemClient } from './MargemClient'

export const dynamic = 'force-dynamic'

export default async function MargemPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  await assertFinanceAccess(orgSlug)
  return <MargemClient orgSlug={orgSlug} hoje={hojeBRT()} />
}
