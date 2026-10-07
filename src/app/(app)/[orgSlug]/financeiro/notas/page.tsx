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
 * O que tira um item da lista — qualquer um dos três prova que a nota existe:
 *  • NFS-e autorizada emitida pelo Flow;
 *  • NF anexada cujo emitente é a AGÊNCIA. A NF do fornecedor não conta: é a
 *    cobrança dele ao cliente, não a nota de comissão da casa (o diálogo de
 *    emissão sempre usou essa régua; a tela não usava, e trataria a NF do
 *    veículo como se a agência já tivesse emitido);
 *  • `nf_emitida` marcado — a nota que saiu FORA do Flow (emissor web) e que
 *    só a pessoa sabe que existe. Sem essa saída a linha ficaria na tela para
 *    sempre, e uma lista com item eterno vira lista que ninguém lê.
 *
 * Só produção e mídia: lançamento manual ("Estorno linha telefone") não é
 * serviço prestado. OFX e Conta Azul são extrato e histórico.
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
    .select('id, descricao, valor, competencia, vencimento, origem_tipo, origem_id, origem_parte, anexos, nf_emitida, boleto_gerado, contato_nome, centro_custo, workspaces(name)')
    .eq('org_id', org.id)
    .eq('tipo', 'entrada')
    .in('origem_tipo', ['producao', 'midia'])
    .lte('competencia', fimDoMes)
    .order('competencia', { ascending: true })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linhas = unwrap<any>(res, 'lançamentos do mês')
  const ids = linhas.map(l => l.id)

  // Quem já tem nota emitida pelo Flow sai da lista. Uma consulta para todos.
  const emitidas = new Set<string>()
  if (ids.length) {
    const { data: notas } = await sb.from('nota_fiscal')
      .select('lancamento_id').in('lancamento_id', ids).eq('status', 'autorizada')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const n of (notas ?? []) as any[]) emitidas.add(n.lancamento_id)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nfDaAgencia = (anexos: any[]) => anexos.some(a =>
    a?.tipo === 'NF' && (!a?.emitente || a.emitente === 'agencia'))

  const pendentes = linhas
    .filter(l => !emitidas.has(l.id))
    .filter(l => !nfDaAgencia(l.anexos ?? []))
    .filter(l => !l.nf_emitida)

  // O documento de origem é o que dá sentido à linha. A descrição do lançamento
  // é "Desconto Padrão Agência" em toda mídia — idêntica nas 7 linhas da É O
  // Amor, e escondia que MX 1632 (bisemana 42) e MX 1633 (bisemana 44) são
  // veiculações diferentes, cada uma com a sua nota.
  const idsMidia = [...new Set(pendentes.filter(l => l.origem_tipo === 'midia').map(l => l.origem_id))]
  const idsProd = [...new Set(pendentes.filter(l => l.origem_tipo === 'producao').map(l => l.origem_id))]
  const [resMidia, resProd] = await Promise.all([
    idsMidia.length
      ? sb.from('midias').select('id, serie, numero, titulo, detalhe, veiculos(name)').in('id', idsMidia)
      : Promise.resolve({ data: [] }),
    idsProd.length
      ? sb.from('producao').select('id, serie, numero, titulo').in('id', idsProd)
      : Promise.resolve({ data: [] }),
  ])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docs = new Map<string, any>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const d of [...(resMidia.data ?? []), ...(resProd.data ?? [])] as any[]) docs.set(d.id, d)

  const itens: ItemNota[] = pendentes.map(l => {
    const d = docs.get(l.origem_id)
    const periodo = String(d?.detalhe?.periodo ?? '').replace(' até ', ' – ')
    return {
      id: l.id,
      doc: d ? `${d.serie ?? ''} ${d.numero ?? ''}`.trim() : null,
      titulo: d?.titulo || l.descricao || '',
      // Linha de apoio: por onde e quando. É o que distingue duas mídias do
      // mesmo cliente com o mesmo valor.
      detalhe: [d?.veiculos?.name, periodo].filter(Boolean).join(' · ') || null,
      parte: l.origem_parte === 'producao' ? 'Comissão de produção' : null,
      valor: Number(l.valor ?? 0),
      competencia: (l.competencia ?? l.vencimento ?? '').slice(0, 10),
      origem: l.origem_tipo as 'producao' | 'midia',
      cliente: l.workspaces?.name ?? l.contato_nome ?? l.centro_custo ?? 'Sem cliente',
      boleto: !!l.boleto_gerado,
    }
  })

  return <NotasDoMesClient orgSlug={orgSlug} itens={itens} mesCorrente={hoje.slice(0, 7)} />
}
