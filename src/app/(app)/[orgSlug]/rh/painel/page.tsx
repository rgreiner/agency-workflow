import { assertRhAccess } from '@/lib/rh'
import { PainelClient } from './PainelClient'

export const dynamic = 'force-dynamic'

export default async function PainelRhPage({ params, searchParams }: {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ meses?: string }>
}) {
  const { orgSlug } = await params
  const { meses } = await searchParams
  const { supabase, orgId } = await assertRhAccess(orgSlug)
  const n = Math.min(36, Math.max(3, Number(meses) || 12))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).rpc('rh_dashboard', { p_org: orgId, p_meses: n })

  return <PainelClient orgSlug={orgSlug} meses={n} d={data} />
}
