import { assertFinanceAccess } from '@/lib/finance'
import type { FluxoRow } from '@/lib/fluxo-caixa'
import { FluxoCaixaClient } from './FluxoCaixaClient'

export const metadata = { title: 'Financeiro — Fluxo de caixa' }

const PAGE = 1000

export default async function FluxoCaixaPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // PostgREST limita o nº de linhas por request — pagina até esgotar.
  const rows: FluxoRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('extrato_importado')
      .select('data_mov, data_prevista, venc_original, tipo, valor, situacao, conta, origem, categoria')
      .eq('org_id', orgId)
      .order('data_mov', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    rows.push(...(data as FluxoRow[]))
    if (data.length < PAGE) break
  }

  return <FluxoCaixaClient orgSlug={orgSlug} rows={rows} />
}
