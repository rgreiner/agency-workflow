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

  // `fin_movimentos` (migration 185) é a fonte única do caixa: histórico realizado
  // do extrato da Conta Azul + o livro-caixa vivo (`lancamentos`), sem contar nada
  // duas vezes, mais o previsto. Antes esta tela lia só `extrato_importado`, que
  // parou no corte de 16/07/2026 — mostrava um retrato envelhecendo há semanas.
  //
  // PostgREST limita o nº de linhas por request — pagina até esgotar.
  const rows: FluxoRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('fin_movimentos')
      .select('data_mov, data_prevista, tipo, valor, situacao, conta, categoria, transferencia')
      .eq('org_id', orgId)
      .order('data_mov', { ascending: true })
      .range(from, from + PAGE - 1)
    // Falha de query não pode virar "tela vazia" num painel de caixa: sem dado
    // nenhum a leitura é "não tem nada a receber", que é uma decisão errada.
    if (error) throw new Error(`Falha ao carregar o fluxo de caixa: ${error.message}`)
    if (!data || data.length === 0) break
    rows.push(...(data as FluxoRow[]))
    if (data.length < PAGE) break
  }

  return <FluxoCaixaClient orgSlug={orgSlug} rows={rows} />
}
