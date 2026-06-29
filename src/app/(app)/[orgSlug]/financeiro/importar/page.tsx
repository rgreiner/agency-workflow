import { assertFinanceAccess } from '@/lib/finance'
import { ImportarClient } from './ImportarClient'

export const metadata = { title: 'Financeiro — Importar extrato' }

export default async function ImportarPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { count } = await sb
    .from('extrato_importado')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)

  const { data: ultimo } = await sb
    .from('extrato_importado')
    .select('imported_at')
    .eq('org_id', orgId)
    .order('imported_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return (
    <ImportarClient
      orgSlug={orgSlug}
      totalAtual={count ?? 0}
      ultimoImport={ultimo?.imported_at ?? null}
    />
  )
}
