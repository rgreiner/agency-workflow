import { assertFinanceAccess } from '@/lib/finance'
import type { CuboRow } from '@/lib/fin-cubo'
import type { CategoriaGrupoLike } from '@/lib/finance-categorias'
import { PlanejamentoClient } from './PlanejamentoClient'

export const metadata = { title: 'Financeiro — Planejamento' }

const PAGE = 1000
/** Entra no caixa projetado: o que vira dinheiro sem vender nada. Imóvel e cartão, não. */
const LIQUIDAS = new Set(['banco', 'caixa', 'aplicacao'])

/**
 * Planejamento: real × projeção por categoria e o saldo mês a mês (pedido do Rafael,
 * 29/10/2026). Mesma carga da Análise (`fin_cubo`) — a projeção e o cenário são
 * cálculo no navegador (`lib/fin-planejamento`), nada aqui grava.
 */
export default async function PlanejamentoPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // Erro levanta em vez de virar lista vazia: projeção sem dado leria "não há custo".
  async function cubo(): Promise<CuboRow[]> {
    const out: CuboRow[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.rpc('fin_cubo', { p_org: orgId }).range(from, from + PAGE - 1)
      if (error) throw new Error(`Falha ao carregar o planejamento: ${error.message}`)
      if (!data || data.length === 0) break
      out.push(...(data as CuboRow[]))
      if (data.length < PAGE) break
    }
    return out
  }

  const [rows, resSettings, resContas] = await Promise.all([
    cubo(),
    sb.from('org_settings').select('finance_categorias').eq('org_id', orgId).maybeSingle(),
    sb.from('contas_saldo').select('nome, tipo, saldo_atual, ativo'),
  ])
  if (resContas.error) throw new Error(`Falha ao carregar o saldo das contas: ${resContas.error.message}`)

  const contas = (resContas.data ?? []) as { nome: string; tipo: string | null; saldo_atual: number | string; ativo: boolean }[]
  const liquidas = contas.filter(c => c.ativo && LIQUIDAS.has(c.tipo ?? ''))
  const saldoInicial = liquidas.reduce((s, c) => s + Number(c.saldo_atual || 0), 0)
  const imoveis = contas.filter(c => c.ativo && c.tipo === 'imobiliario').reduce((s, c) => s + Number(c.saldo_atual || 0), 0)

  return (
    <PlanejamentoClient
      rows={rows}
      categorias={(resSettings?.data?.finance_categorias ?? []) as CategoriaGrupoLike[]}
      saldoInicial={saldoInicial}
      contasLiquidas={liquidas.map(c => c.nome)}
      imoveis={imoveis}
    />
  )
}
