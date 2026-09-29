'use server'

import { createClient } from '@/lib/supabase/server'
import { assertFinanceAccess } from '@/lib/finance'
import { getUsuario } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'
import { bytesDeUpload, mimeDoArquivo } from '@/lib/uploads-volume'
import { lerCupom, type ItemLido } from '@/lib/ai/cupom'
import { logSystemError } from '@/lib/system-error'

/**
 * Itens da compra (mig. 307): o que compõe um lançamento de despesa.
 *
 * A IA lê o cupom que JÁ está anexado — não há upload novo. O lançamento não é
 * tocado: o item é camada de leitura, e quando a soma não fecha com o total a
 * tela avisa em vez de "corrigir" o valor.
 */

export interface ItemCompra {
  id?: string
  descricao: string
  produto: string | null
  quantidade: number | null
  unidade: string | null
  valor_unitario: number | null
  valor_total: number
  origem?: 'ia' | 'manual'
  /** false = compra pessoal de quem foi ao mercado: fica listada, fora da conta. */
  empresa?: boolean
}

interface AnexoRef { url?: string | null; nome?: string | null; tipo?: string | null }

/**
 * Arquivos legíveis do lançamento — TODOS, não o primeiro: cupom de mercado
 * chega fotografado em pedaços (a compra de 21/09 veio em 3 fotos). NF na
 * frente, boleto atrás (boleto não tem item nenhum).
 */
function documentosDaCompra(anexos: unknown): AnexoRef[] {
  const lista = (Array.isArray(anexos) ? anexos : []) as AnexoRef[]
  const peso = (a: AnexoRef) => (a.tipo === 'NF' ? 0 : a.tipo === 'Boleto' ? 2 : 1)
  return lista
    .filter(a => !!a?.url && !!mimeDoArquivo(a.url ?? ''))
    .sort((a, b) => peso(a) - peso(b))
    .slice(0, 5)   // teto: 5 imagens já são um cupom inteiro, e cada uma custa
}

export async function lerItensDoLancamento(orgSlug: string, lancamentoId: string) {
  const { supabase } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('lancamento_item')
    .select('id, descricao, quantidade, unidade, valor_unitario, valor_total, origem, empresa, finance_produto(nome)')
    .eq('lancamento_id', lancamentoId)
    .order('ordem')
  if (error) return { error: error.message }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const itens: ItemCompra[] = (data ?? []).map((r: any) => ({
    id: r.id,
    descricao: r.descricao,
    produto: r.finance_produto?.nome ?? null,
    quantidade: r.quantidade != null ? Number(r.quantidade) : null,
    unidade: r.unidade,
    valor_unitario: r.valor_unitario != null ? Number(r.valor_unitario) : null,
    valor_total: Number(r.valor_total),
    origem: r.origem,
    empresa: r.empresa !== false,
  }))
  return { itens }
}

export async function salvarItens(orgSlug: string, lancamentoId: string, itens: ItemCompra[]) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('set_lancamento_itens', {
    p_user_id: user.id,
    p_lancamento_id: lancamentoId,
    p_itens: itens.map(i => ({
      descricao: i.descricao,
      produto: i.produto ?? '',
      quantidade: i.quantidade ?? null,
      unidade: i.unidade ?? '',
      valor_unitario: i.valor_unitario ?? null,
      valor_total: i.valor_total,
      origem: i.origem ?? 'manual',
      empresa: i.empresa === false ? 'false' : 'true',
    })),
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
  return {}
}

/**
 * Lê o documento anexado e grava os itens. Devolve o que leu para a tela já
 * mostrar — e o total do documento, quando o cupom traz, para conferência.
 */
export async function detalharCompra(orgSlug: string, lancamentoId: string) {
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: lanc, error: e1 } = await (supabase as any)
    .from('lancamentos').select('id, anexos, valor, valor_realizado').eq('id', lancamentoId).single()
  if (e1 || !lanc) return { error: 'Lançamento não encontrado' }

  const docs = documentosDaCompra(lanc.anexos)
  if (docs.length === 0) return { error: 'Este lançamento não tem cupom nem nota anexada (PDF ou foto).' }

  const arquivos: { bytes: Buffer; mimeType: string }[] = []
  for (const d of docs) {
    const bytes = await bytesDeUpload(d.url)
    if (bytes) arquivos.push({ bytes, mimeType: mimeDoArquivo(d.url ?? '') ?? 'application/pdf' })
  }
  if (arquivos.length === 0) return { error: 'O arquivo anexado não foi encontrado no servidor.' }

  const valor = Number(lanc.valor_realizado ?? lanc.valor) || 0

  try {
    const lido = await lerCupom(orgId, arquivos)
    if (!lido) return { error: 'Nenhuma chave de IA configurada (Configurações → Revisão IA).' }
    if (lido.itens.length === 0) return { error: 'A IA não encontrou itens neste documento. Confira se o anexo é o cupom da compra.' }

    // Documento MUITO maior que o lançamento = anexo de outra coisa. Acontece de
    // verdade: a fatura do cartão (R$ 4.126,69, com Conta Azul e Adobe dentro)
    // estava anexada a uma compra de mercado de R$ 142,02 — gravar aqueles 18
    // itens envenenaria o cadastro de produto e a série do ano inteira.
    //
    // O corte é 3× de propósito, não 2×: divergência pequena é comum e legítima
    // (o cupom de 21/09 soma R$ 201,01 num lançamento de R$ 93,48 — os itens são
    // reais, o rateio do dinheiro é que não bate). Esse caso precisa GRAVAR e
    // aparecer no selo de conferência; quem decide é a pessoa, não a trava.
    const soma = lido.itens.reduce((s, i) => s + i.valor_total, 0)
    const maior = Math.max(soma, lido.total_documento ?? 0)
    if (valor > 0 && maior > valor * 3 + 20) {
      return { error: `O anexo soma ${maior.toFixed(2)} — muito acima deste lançamento (${valor.toFixed(2)}). Parece ser outro documento (fatura de cartão?), não o cupom desta compra. Nada foi gravado.` }
    }
    const totalDoc = lido.total_documento

    const r = await salvarItens(orgSlug, lancamentoId, lido.itens.map((i: ItemLido) => ({ ...i, origem: 'ia' as const })))
    if (r?.error) return { error: r.error }
    return { itens: lido.itens.length, total_documento: totalDoc, arquivo: docs[0]?.nome ?? null }
  } catch (error) {
    // Erro de 2º plano nunca vira dump na cara de quem usa.
    try { await logSystemError(supabase, { userId: user.id, context: 'ai:cupom', error }) } catch { /* best-effort */ }
    return { error: 'Não foi possível ler o documento agora. Tente de novo em instantes.' }
  }
}

/**
 * Detalha em lote as compras que ainda não têm itens — serve para recuperar o
 * histórico de uma vez (17 cupons já anexados em 29/09/2026). Limite baixo de
 * propósito: é uma chamada de IA por documento, e a tela espera.
 */
export async function detalharPendentes(orgSlug: string, limite = 10) {
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: comItens } = await sb.from('lancamento_item').select('lancamento_id').eq('org_id', orgId)
  const jaTem = new Set<string>(((comItens ?? []) as { lancamento_id: string }[]).map(r => r.lancamento_id))

  const { data: candidatos, error } = await sb
    .from('lancamentos')
    .select('id, anexos, descricao, categoria')
    .eq('org_id', orgId).eq('tipo', 'saida')
    .order('vencimento', { ascending: false })
    .limit(400)
  if (error) return { error: error.message }

  const fila = ((candidatos ?? []) as { id: string; anexos: unknown; categoria: string | null }[])
    .filter(l => !jaTem.has(l.id) && documentosDaCompra(l.anexos).length > 0)
    .slice(0, Math.max(1, Math.min(limite, 25)))

  let ok = 0
  const falhas: string[] = []
  for (const l of fila) {
    const r = await detalharCompra(orgSlug, l.id)
    if ('error' in r && r.error) falhas.push(r.error); else ok++
  }
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
  return { processados: fila.length, ok, falhas: falhas.slice(0, 3) }
}
