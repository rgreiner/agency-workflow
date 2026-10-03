import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { unwrap } from '@/lib/supabase/unwrap'
import { NotasDoMesClient, type ItemNota } from './NotasDoMesClient'

export const metadata = { title: 'Financeiro — NF do mês' }
export const dynamic = 'force-dynamic'

/**
 * NF do mês: o que precisa de nota fiscal nesta competência.
 *
 * Existe porque emitir nota virou trabalho MENSAL. O Faturamento cuida do
 * documento que acabou (acontece uma vez); aqui ficam as parcelas que vão
 * alcançando a competência mês a mês — um fee 12x gera doze emissões ao longo
 * de um ano, cada uma no seu mês, e procurá-las no meio dos lançamentos é
 * garimpo.
 *
 * Três exclusões, cada uma medida em produção (03/10/2026) sobre os 196
 * lançamentos que o filtro "sem nota" acusava com competência já chegada:
 *  • 95 já tinham a NF ANEXADA — nota existe, só não foi emitida pelo Flow
 *    (as da prefeitura, antes da integração). Não há o que fazer com elas.
 *  • 71 eram movimentos de OFX e 24 importações do Conta Azul — extrato e
 *    histórico, nunca foram item de nota.
 *  • sobra o que a agência fatura como SERVIÇO: produção e mídia. Lançamento
 *    manual ("Estorno linha telefone", "Venda mesa e cadeira") fica de fora
 *    porque não é serviço prestado, e nota de serviço não cobre isso.
 */
export default async function NotasDoMesPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) redirect('/login')

  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) redirect('/')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const hoje = new Date().toISOString().slice(0, 10)
  // Último dia do mês corrente: a parcela que vence dia 23 e a que vence dia 2
  // são do mesmo mês de trabalho, então o corte é o mês, não o dia de hoje.
  const fimDoMes = new Date(Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)), 0))
    .toISOString().slice(0, 10)

  const res = await sb.from('lancamentos')
    .select('id, descricao, valor, competencia, vencimento, origem_tipo, origem_id, anexos, workspace_id, contato_nome, centro_custo, workspaces(name)')
    .eq('org_id', org.id)
    .eq('tipo', 'entrada')
    .in('origem_tipo', ['producao', 'midia'])
    .lte('competencia', fimDoMes)
    .order('competencia', { ascending: true })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linhas = unwrap<any>(res, 'lançamentos do mês')
  const ids = linhas.map(l => l.id)

  // Quem já tem nota emitida pelo Flow sai da lista. Uma consulta para todos:
  // a tela precisa saber de todos, e uma por linha seria absurdo.
  const emitidas = new Set<string>()
  if (ids.length) {
    const { data: notas } = await sb.from('nota_fiscal')
      .select('lancamento_id').in('lancamento_id', ids).eq('status', 'autorizada')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const n of (notas ?? []) as any[]) emitidas.add(n.lancamento_id)
  }

  const itens: ItemNota[] = linhas
    .filter(l => !emitidas.has(l.id))
    // NF anexada à mão (a da prefeitura, ou a do fornecedor) também resolve:
    // a nota existe, e cobrar de novo seria emitir em duplicidade.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter(l => !((l.anexos ?? []) as any[]).some(a => a?.tipo === 'NF'))
    .map(l => ({
      id: l.id,
      descricao: l.descricao ?? '',
      valor: Number(l.valor ?? 0),
      competencia: (l.competencia ?? l.vencimento ?? '').slice(0, 10),
      origem: l.origem_tipo as 'producao' | 'midia',
      cliente: l.workspaces?.name ?? l.contato_nome ?? l.centro_custo ?? 'Sem cliente',
    }))

  return <NotasDoMesClient orgSlug={orgSlug} itens={itens} mesCorrente={hoje.slice(0, 7)} />
}
