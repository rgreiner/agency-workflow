'use server'

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { logSystemError } from '@/lib/system-error'
import { uploadRoot } from '@/lib/uploads-volume'
import { novoToken } from '@/lib/cotacao-server'
import { chaveNome } from '@/lib/nomes'
import { somenteDigitos } from '@/lib/telefone'
import { lerPropostaFornecedor, type PropostaLida } from '@/lib/ai/proposta-fornecedor'
import {
  aplicarResposta, MAX_LINHAS_ITEM, MAX_QUANT,
  type ArquivoRef, type CotacaoItem, type ItemOrcBase, type Resposta, type RespostaPreco,
} from '@/lib/cotacao'
import { createFornecedorRapido } from './fornecedor'

/**
 * Proposta que o fornecedor mandou POR FORA (PDF/foto por e-mail ou WhatsApp):
 * a IA lê, a pessoa confere na tela e a proposta entra como RESPOSTA de cotação —
 * mesmas opções no orçamento, mesmo comparativo e mesmo PDF de quem respondeu
 * pelo link. Decisões do Rafael (26/10/2026): sempre passa pela conferência; vira
 * resposta da cotação; fornecedor que não existe nasce do que o PDF diz.
 */

type Sb = Awaited<ReturnType<typeof createClient>>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (s: Sb) => s as any

const MIME: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }

async function contexto(orgSlug: string) {
  const user = await getUsuario()
  if (!user) return null
  const supabase = await createClient()
  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  return org ? { user, supabase, orgId: org.id as string } : null
}

/** Arquivo só vale se foi a própria org que subiu (rota /api/cotacao/anexo-agencia). */
const arquivoDaOrg = (orgId: string, a: ArquivoRef) =>
  typeof a?.chave === 'string' && a.chave.startsWith(`cotacao-privado/agencia/${orgId}/`) && !a.chave.includes('..')

export interface LeituraProposta {
  error?: string
  lida?: PropostaLida
  /** Fornecedor do cadastro que bate com o PDF (CNPJ, senão nome). */
  fornecedorId?: string | null
}

/** Lê um arquivo de proposta já enviado. Não grava nada — só sugere. */
export async function lerPropostaPdf(orgSlug: string, arquivo: ArquivoRef): Promise<LeituraProposta> {
  const ctx = await contexto(orgSlug)
  if (!ctx) return { error: 'Não autenticado' }
  if (!arquivoDaOrg(ctx.orgId, arquivo)) return { error: 'Arquivo inválido' }
  const ext = arquivo.chave.split('.').pop()?.toLowerCase() ?? ''
  const mimeType = MIME[ext]
  if (!mimeType) return { error: 'A leitura aceita PDF ou foto (JPG, PNG, WebP).' }

  try {
    const bytes = await readFile(path.join(uploadRoot(), arquivo.chave))
    const lida = await lerPropostaFornecedor(ctx.orgId, { bytes, mimeType })
    if (!lida) return { error: 'A IA não está configurada (Configurações → Revisão IA).' }
    if (!lida.itens.length) return { error: 'Não encontrei itens com preço neste arquivo — preencha à mão ou tente outro arquivo.', lida }

    const { data: forns } = await db(ctx.supabase).from('fornecedores').select('id, name, tax_id').eq('org_id', ctx.orgId).eq('archived', false)
    const lista = (forns ?? []) as { id: string; name: string; tax_id: string | null }[]
    const cnpj = lida.fornecedor.cnpj
    const porCnpj = cnpj.length >= 11 ? lista.find(f => somenteDigitos(f.tax_id ?? '') === cnpj) : undefined
    const k = chaveNome(lida.fornecedor.nome)
    const porNome = k ? (lista.find(f => chaveNome(f.name) === k) ?? lista.find(f => {
      const n = chaveNome(f.name)
      return n.length >= 4 && (k.includes(n) || n.includes(k))
    })) : undefined
    return { lida, fornecedorId: (porCnpj ?? porNome)?.id ?? null }
  } catch (e) {
    await logSystemError(ctx.supabase, { userId: ctx.user.id, context: 'cotação: leitura de proposta em PDF', error: e })
    return { error: 'Não consegui ler este arquivo agora. Tente de novo em instantes ou preencha à mão.' }
  }
}

export interface PropostaConferida {
  arquivo: ArquivoRef
  fornecedor: { id: string } | { novo: { nome: string; cnpj: string; email: string; telefone: string } }
  condicoes: { n_orc: string; prazo_producao: string; validade: string; pgto: string; observacao: string }
  contato: string
  itens: {
    /** Posição do item no orçamento; null = criar item novo. */
    alvo: number | null
    nome: string
    descricao: string
    obs: string
    linhas: RespostaPreco[]
  }[]
}

/**
 * Grava a proposta conferida: garante o fornecedor, cria os itens novos no
 * orçamento, registra a resposta numa cotação e aplica as opções. Devolve os
 * itens do orçamento como ficaram, para o formulário aberto se atualizar.
 */
export async function registrarPropostaLida(orgSlug: string, producaoId: string, p: PropostaConferida): Promise<{ error?: string; itens?: unknown[] }> {
  const ctx = await contexto(orgSlug)
  if (!ctx) return { error: 'Não autenticado' }
  const { supabase, orgId, user } = ctx
  if (!arquivoDaOrg(orgId, p.arquivo)) return { error: 'Arquivo inválido' }

  const txt = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e10 ? Math.round(v * 10000) / 10000 : null)
  const itensIn = p.itens.map(it => {
    const vistos = new Set<string>()
    const linhas = (it.linhas ?? []).map(l => ({
      variante: txt(l.variante, 80),
      quant: Number.isInteger(l.quant) && l.quant > 0 && l.quant <= MAX_QUANT ? l.quant : 0,
      unit: num(l.unit), total: num(l.total),
    })).filter(l => {
      if (!l.quant || (!l.unit && !l.total)) return false
      const k = `${l.variante.toLowerCase()}|${l.quant}`
      if (vistos.has(k)) return false
      vistos.add(k); return true
    }).slice(0, MAX_LINHAS_ITEM)
    return { alvo: it.alvo, nome: txt(it.nome, 200), descricao: txt(it.descricao, 3000), obs: txt(it.obs, 1000), linhas }
  }).filter(it => it.linhas.length && (it.alvo != null || it.nome))
  if (!itensIn.length) return { error: 'Nenhum item com quantidade e preço para gravar.' }

  const { data: prod } = await db(supabase).from('producao').select('id, tipo, detalhe').eq('id', producaoId).eq('org_id', orgId).single()
  if (!prod || prod.tipo !== 'orcamento') return { error: 'Orçamento não encontrado' }

  // ── Fornecedor ──
  let fornecedorId: string
  if ('id' in p.fornecedor) {
    fornecedorId = p.fornecedor.id
  } else {
    const novo = p.fornecedor.novo
    const r = await createFornecedorRapido(orgSlug, novo.nome)
    if ('error' in r && r.error) return { error: `Fornecedor: ${r.error}` }
    fornecedorId = (r as { id: string }).id
    // Nasceu agora: já leva o que o PDF diz (homônimo existente fica como está).
    if (!(r as { existente?: boolean }).existente) {
      const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(novo.email) ? novo.email : ''
      const doc = somenteDigitos(novo.cnpj)
      await db(supabase).from('fornecedores').update({
        ...(doc.length === 14 || doc.length === 11 ? { tax_id: novo.cnpj } : {}),
        ...(email ? { emails: [{ tipo: p.contato || '', email }] } : {}),
        ...(novo.telefone ? { telefones: [{ tipo: 'Comercial', numero: novo.telefone }] } : {}),
      }).eq('id', fornecedorId)
    }
  }

  // ── Itens do orçamento: os "novos" entram no fim ──
  const det = (prod.detalhe ?? {}) as { itens?: (ItemOrcBase & Record<string, unknown>)[] }
  const itensOrc = Array.isArray(det.itens) ? [...det.itens] : []
  const alvos = itensIn.map(it => {
    if (it.alvo != null && itensOrc[it.alvo]) return it.alvo
    itensOrc.push({ nome: it.nome, descricao: it.descricao, job: '', opcoes: [] })
    return itensOrc.length - 1
  })
  const pedidosDaProposta: CotacaoItem[] = itensIn.map((it, i) => ({
    idx: alvos[i], nome: itensOrc[alvos[i]].nome, descricao: String(itensOrc[alvos[i]].descricao ?? ''),
    faixas: [...new Set(it.linhas.map(l => l.quant))].sort((a, b) => a - b).slice(0, 4),
  }))

  // ── Onde a resposta mora ──
  // 1) O fornecedor foi convidado pelo link e respondeu por fora: usa o convite dele,
  //    se a cotação pediu exatamente esses itens.
  // 2) Senão, a cotação "importada" do orçamento (nenhum fornecedor vê; cresce à vontade).
  const { data: cots } = await db(supabase).from('cotacoes')
    .select('id, origem, itens, convites:cotacao_convites(id, fornecedor_id, respondido_em)')
    .eq('producao_id', producaoId).order('created_at', { ascending: false })
  type Cot = { id: string; origem: string; itens: CotacaoItem[]; convites: { id: string; fornecedor_id: string; respondido_em: string | null }[] }
  const lista = (cots ?? []) as Cot[]
  const cobre = (c: Cot) => pedidosDaProposta.every(pd => c.itens.some(i => i.idx === pd.idx && chaveNome(i.nome) === chaveNome(pd.nome)))
  let cotacaoId: string, conviteId: string, pedidos: CotacaoItem[]
  const doLink = lista.find(c => c.origem === 'link' && cobre(c) && c.convites.some(v => v.fornecedor_id === fornecedorId && !v.respondido_em))
  if (doLink) {
    cotacaoId = doLink.id
    conviteId = doLink.convites.find(v => v.fornecedor_id === fornecedorId)!.id
    pedidos = doLink.itens
  } else {
    let imp = lista.find(c => c.origem === 'importada')
    if (!imp) {
      const { data, error } = await db(supabase).from('cotacoes').insert({
        org_id: orgId, producao_id: producaoId, origem: 'importada', encerrada: true, itens: [], created_by: user.id,
      }).select('id, origem, itens').single()
      if (error || !data) return { error: error?.code === '42501' ? 'Só gerente ou admin registra proposta.' : 'Não foi possível registrar a proposta.' }
      imp = { ...data, convites: [] } as Cot
    }
    pedidos = [...imp.itens]
    for (const pd of pedidosDaProposta) {
      const i = pedidos.findIndex(x => x.idx === pd.idx)
      if (i < 0) pedidos.push(pd)
      else pedidos[i] = { ...pedidos[i], nome: pd.nome, faixas: [...new Set([...pedidos[i].faixas, ...pd.faixas])].sort((a, b) => a - b) }
    }
    await db(supabase).from('cotacoes').update({ itens: pedidos }).eq('id', imp.id)
    cotacaoId = imp.id
    const existente = imp.convites.find(v => v.fornecedor_id === fornecedorId)
    if (existente) conviteId = existente.id
    else {
      const { data, error } = await db(supabase).from('cotacao_convites')
        .insert({ org_id: orgId, cotacao_id: cotacaoId, fornecedor_id: fornecedorId, token: novoToken() }).select('id').single()
      if (error || !data) return { error: 'Não foi possível registrar a proposta.' }
      conviteId = data.id
    }
  }

  // ── Resposta + opções no orçamento ──
  const resposta: Resposta = {
    itens: itensIn.map((it, i) => ({ idx: alvos[i], nao_fornece: false, precos: it.linhas, obs: it.obs, fotos: [] })),
    n_orc: txt(p.condicoes.n_orc, 60), prazo_producao: txt(p.condicoes.prazo_producao, 200),
    validade: txt(p.condicoes.validade, 200), pgto: txt(p.condicoes.pgto, 200), observacao: txt(p.condicoes.observacao, 3000),
  }
  const agora = new Date().toISOString()
  const { error: e2 } = await db(supabase).from('cotacao_convites').update({
    resposta, resposta_anexos: [{ chave: p.arquivo.chave, nome: txt(p.arquivo.nome, 160) || 'proposta.pdf' }],
    dados_fornecedor: 'novo' in p.fornecedor ? { contato: p.contato, cnpj: p.fornecedor.novo.cnpj, email: p.fornecedor.novo.email, whatsapp: p.fornecedor.novo.telefone } : null,
    respondido_em: agora, aberto_em: agora, recusado_em: null,
  }).eq('id', conviteId)
  if (e2) return { error: 'Não foi possível registrar a proposta.' }

  const novos = aplicarResposta(itensOrc, conviteId, fornecedorId, pedidos, resposta)
  const { error: e3 } = await db(supabase).from('producao').update({ detalhe: { ...det, itens: novos } }).eq('id', producaoId)
  if (e3) return { error: 'A proposta foi registrada, mas o orçamento não atualizou — recarregue a página.' }

  revalidatePath(`/${orgSlug}/producao/orcamento/${producaoId}`)
  return { itens: novos }
}
