import { assertFinanceAccess } from '@/lib/finance'
import { unwrap } from '@/lib/supabase/unwrap'
import { LixeiraClient, type LixeiraItem } from './LixeiraClient'

// Busca da própria API — o builder não alcança o IP público do VPS.
export const dynamic = 'force-dynamic'

export const metadata = { title: 'Financeiro — Lixeira do extrato' }

export default async function LixeiraPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // View `extrato_lixeira` (migration 203): junta o descarte com a linha do extrato e
  // com quem descartou. O join não dá pra fazer pelo PostgREST — a chave é composta e
  // o import_ref tem vírgula e parêntese dentro, que arrebentam um filtro `in.(...)`.
  const itens = unwrap<LixeiraItem>(
    await sb.from('extrato_lixeira')
      .select('import_ref, motivo, descartado_em, descartado_por, existe, contato, descricao, categoria, conta, tipo, situacao, valor, vencimento, promovido')
      .eq('org_id', orgId)
      .order('descartado_em', { ascending: false }),
    'lixeira do extrato',
  )

  return <LixeiraClient orgSlug={orgSlug} itens={itens} today={new Date().toISOString().slice(0, 10)} />
}
