import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { unwrap } from '@/lib/supabase/unwrap'
import { CustosClient, type PedidoCusto } from './CustosClient'
import type { ContaRef } from '../faturamento/ClassificacaoFields'

export const metadata = { title: 'Financeiro — Custos de produção' }
export const dynamic = 'force-dynamic'

/**
 * Custos de produção: a NF que o fornecedor mandou vira despesa colada no pedido.
 *
 * Por que esta tela existe: a receita já tinha rastro até o documento (mig.
 * 322/323), o custo não. Medido em 03/10/2026 — 30 dos 76 pedidos têm
 * fornecedor vinculado, e o item do PP guarda só o `valor` que o CLIENTE paga;
 * não há campo de custo em lugar nenhum. O custo entrava como lançamento manual
 * com o centro de custo certo (a margem fechava) e nenhum elo com o pedido.
 *
 * Mostra os pedidos que têm fornecedor e já saíram do orçamento. O de cima é o
 * que ainda não tem custo nenhum — é essa a fila de trabalho.
 */
export default async function CustosPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) redirect('/login')

  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) redirect('/')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [prodRes, contasRes, fornRes] = await Promise.all([
    sb.from('producao')
      .select('id, serie, numero, titulo, valor, situacao, detalhe, workspaces(name)')
      .eq('org_id', org.id)
      .in('situacao', ['aprovado', 'faturado'])
      .order('numero', { ascending: false }),
    sb.from('contas_financeiras').select('id, nome, ativo, favorita').eq('org_id', org.id),
    sb.from('fornecedores').select('id, name, tax_id').eq('org_id', org.id).order('name'),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const producoes = (unwrap<any>(prodRes, 'pedidos de produção'))
    .filter(p => p.detalhe?.fornecedor_id)

  // Despesas já lançadas em cada pedido. Uma consulta para todos.
  const ids = producoes.map(p => p.id)
  const gastoPorPedido = new Map<string, { total: number; n: number }>()
  if (ids.length) {
    const { data: desp } = await sb.from('lancamentos')
      .select('origem_id, valor').eq('org_id', org.id).eq('tipo', 'saida')
      .eq('origem_tipo', 'producao').in('origem_id', ids)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const l of (desp ?? []) as any[]) {
      const a = gastoPorPedido.get(l.origem_id) ?? { total: 0, n: 0 }
      gastoPorPedido.set(l.origem_id, { total: a.total + Number(l.valor ?? 0), n: a.n + 1 })
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fornecedores = (unwrap<any>(fornRes, 'fornecedores')).map(f => ({ id: f.id, nome: f.name, cnpj: f.tax_id ?? null }))
  const porId = new Map(fornecedores.map(f => [f.id, f]))

  const pedidos: PedidoCusto[] = producoes.map(p => {
    const g = gastoPorPedido.get(p.id) ?? { total: 0, n: 0 }
    const forn = porId.get(p.detalhe.fornecedor_id)
    return {
      id: p.id,
      doc: `${p.serie ?? 'PP'} ${p.numero ?? ''}`.trim(),
      titulo: p.titulo ?? '',
      cliente: p.workspaces?.name ?? '—',
      situacao: p.situacao,
      valorCliente: Number(p.valor ?? 0),
      custoLancado: g.total,
      notasLancadas: g.n,
      fornecedorId: forn?.id ?? null,
      fornecedorNome: forn?.nome ?? null,
    }
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contasAtivas = (unwrap<any>(contasRes, 'contas')).filter(c => c.ativo)
  const contas: ContaRef[] = contasAtivas.map(c => ({ id: c.id, nome: c.nome }))
  const contaPadrao = (contasAtivas.find(c => c.favorita) ?? contasAtivas[0])?.id ?? ''

  return <CustosClient orgSlug={orgSlug} pedidos={pedidos} contas={contas}
    contaPadrao={contaPadrao} fornecedores={fornecedores} />
}
