import { assertFinanceAccess } from '@/lib/finance'
import { ConciliacaoClient } from './ConciliacaoClient'
import { loadConciliacao } from '@/lib/conciliacao'

export default async function ConciliacaoPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  const data = await loadConciliacao(supabase, orgId)
  return <ConciliacaoClient orgSlug={orgSlug} {...data} />
}
