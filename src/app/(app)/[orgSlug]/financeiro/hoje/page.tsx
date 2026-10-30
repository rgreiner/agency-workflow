import { assertFinanceAccess } from '@/lib/finance'
import { unwrap } from '@/lib/supabase/unwrap'
import { hojeISO } from '@/lib/checklist-datas'
import { linhaDoAnexo } from '@/lib/boleto/do-anexo'
import { tipoPagarCom } from '@/lib/boleto/linha-digitavel'
import type { Lancamento, ContaRef } from '../lancamentos/LancamentosClient'
import { HojeClient, type ItemHoje } from './HojeClient'

// Lista de ação: o que pagar e receber no dia. Muda a cada baixa (minha ou de outra
// pessoa) — nada de render cacheado.
export const dynamic = 'force-dynamic'

const DIA = /^\d{4}-\d{2}-\d{2}$/
const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
const isTransferencia = (l: Lancamento) => !!l.transferencia_id || norm(l.categoria).startsWith('transfer')
/** Título com baixa parcial continua em aberto: o que falta é valor − realizado. */
const falta = (l: Lancamento) => Math.max(Number(l.valor ?? 0) - Number(l.valor_realizado ?? 0), 0)

const CAMPOS = 'id, tipo, origem_tipo, origem_id, transferencia_id, doc_serie, doc_numero, doc_origem, doc_producao_tipo, parcela_num, parcela_total, contato_nome, descricao, valor, valor_realizado, vencimento, competencia, situacao, nf_emitida, boleto_gerado, revisar, conta_id, categoria, centro_custo, data_liquidacao, forma_pagamento, observacao, juros, multa, desconto, tarifa, anexos'

export default async function HojePage({
  params, searchParams,
}: {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ dia?: string }>
}) {
  const { orgSlug } = await params
  const { dia: diaParam } = await searchParams
  const hoje = hojeISO()
  const dia = diaParam && DIA.test(diaParam) ? diaParam : hoje
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [abertos, feitos, contasRaw] = await Promise.all([
    // Em aberto até o dia: o atrasado continua sendo ação do dia.
    sb.from('lancamentos_doc').select(CAMPOS).eq('org_id', orgId)
      .eq('situacao', 'em_aberto').lte('vencimento', dia)
      .order('vencimento', { ascending: true }),
    sb.from('lancamentos_doc').select(CAMPOS).eq('org_id', orgId)
      .in('situacao', ['pago', 'recebido']).eq('data_liquidacao', dia),
    sb.from('contas_saldo').select('id, nome, tipo, cor, ativo, favorita, saldo_atual').eq('org_id', orgId).order('ordem', { ascending: true }),
  ])
  const emAberto = unwrap<Lancamento>(abertos, 'lançamentos em aberto').filter(l => !isTransferencia(l))
  const liquidados = unwrap<Lancamento>(feitos, 'lançamentos do dia').filter(l => !isTransferencia(l))
  const contas = unwrap<ContaRef & { saldo_atual: number | string }>(contasRaw, 'contas').filter(c => c.ativo)

  // "Como pagar" e o contato do cadastro moram na tabela (a view lancamentos_doc
  // foi criada antes da coluna pagar_com e não a expõe).
  const ids = [...emAberto, ...liquidados].map(l => l.id)
  const extras = new Map<string, { pagar_com: string | null; contato_tipo: string | null; contato_id: string | null }>()
  if (ids.length) {
    const rows = unwrap<{ id: string; pagar_com: string | null; contato_tipo: string | null; contato_id: string | null }>(
      await sb.from('lancamentos').select('id, pagar_com, contato_tipo, contato_id').in('id', ids),
      'como pagar',
    )
    for (const r of rows) extras.set(r.id, r)
  }

  const pagar = emAberto.filter(l => l.tipo === 'saida')

  // Boleto anexado sem código: lê a linha digitável do PDF e grava, para a próxima
  // abertura não ler de novo. Falha (PDF escaneado, sem arquivo) só deixa vazio.
  await Promise.all(pagar.map(async l => {
    const ex = extras.get(l.id)
    if (ex?.pagar_com) return
    const boleto = (l.anexos ?? []).find(a => a.tipo === 'Boleto' && a.url)
    if (!boleto) return
    const linha = await linhaDoAnexo(boleto.url)
    if (!linha) return
    extras.set(l.id, { pagar_com: linha, contato_tipo: ex?.contato_tipo ?? null, contato_id: ex?.contato_id ?? null })
    await sb.rpc('set_lancamento_pagar_com', { p_lancamento_id: l.id, p_pagar_com: linha })
  }))

  // Sugestão de Pix para quem ainda não tem código: (1) o último Pix usado para o
  // mesmo contato — salário e fornecedor recorrente repetem a chave todo mês;
  // (2) a chave do cadastro (fornecedor/veículo/cliente). Linha de boleto nunca é
  // sugerida: cada boleto tem a sua.
  const semCodigo = pagar.filter(l => !extras.get(l.id)?.pagar_com)
  const ultimoPix = new Map<string, string>()
  const pixCadastro = new Map<string, string>()
  if (semCodigo.length) {
    const nomes = [...new Set(semCodigo.map(l => l.contato_nome).filter((n): n is string => !!n))]
    const porTipo = (t: string) => [...new Set(semCodigo.map(l => extras.get(l.id)).filter(e => e?.contato_tipo === t && e.contato_id).map(e => e!.contato_id!))]
    const tabelas: [string, string][] = [['fornecedor', 'fornecedores'], ['veiculo', 'veiculos'], ['cliente', 'workspaces']]
    const [anteriores, ...cadastros] = await Promise.all([
      nomes.length
        ? sb.from('lancamentos').select('contato_nome, pagar_com, vencimento').eq('org_id', orgId).eq('tipo', 'saida')
            .in('contato_nome', nomes).not('pagar_com', 'is', null).order('vencimento', { ascending: false }).limit(500)
        : Promise.resolve({ data: [], error: null }),
      ...tabelas.map(([t, tabela]) => {
        const lista = porTipo(t)
        return lista.length
          ? sb.from(tabela).select('id, contas_bancarias').in('id', lista)
          : Promise.resolve({ data: [], error: null })
      }),
    ])
    for (const r of unwrap<{ contato_nome: string; pagar_com: string }>(anteriores, 'Pix anteriores')) {
      const k = norm(r.contato_nome)
      if (!ultimoPix.has(k) && tipoPagarCom(r.pagar_com) !== 'boleto') ultimoPix.set(k, r.pagar_com)
    }
    cadastros.forEach((res, i) => {
      for (const c of unwrap<{ id: string; contas_bancarias: { pix?: string }[] | null }>(res, `cadastro ${tabelas[i][1]}`)) {
        const pix = (c.contas_bancarias ?? []).map(b => (b.pix ?? '').trim()).find(Boolean)
        if (pix) pixCadastro.set(`${tabelas[i][0]}:${c.id}`, pix)
      }
    })
  }

  const item = (l: Lancamento): ItemHoje => {
    const ex = extras.get(l.id)
    const sugestao = ex?.pagar_com || l.tipo !== 'saida' ? null
      : ultimoPix.get(norm(l.contato_nome))
        ?? (ex?.contato_tipo && ex.contato_id ? pixCadastro.get(`${ex.contato_tipo}:${ex.contato_id}`) : undefined)
        ?? null
    return {
      ...l,
      falta: falta(l),
      pagar_com: ex?.pagar_com ?? null,
      sugestao,
      boleto_url: (l.anexos ?? []).find(a => a.tipo === 'Boleto' && a.url)?.url ?? null,
    }
  }

  const liquidas = contas.filter(c => c.tipo !== 'cartao')
  const saldo = liquidas.reduce((s, c) => s + Number(c.saldo_atual ?? 0), 0)

  return (
    <HojeClient
      key={dia}
      orgSlug={orgSlug}
      dia={dia}
      hoje={hoje}
      saldo={saldo}
      contas={contas}
      contaPadrao={contas.find(c => c.favorita)?.id ?? ''}
      abertos={emAberto.map(item)}
      feitos={liquidados.map(item)}
    />
  )
}
