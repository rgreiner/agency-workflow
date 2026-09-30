/**
 * Pedido de cotação (mig. 310): tipos e a regra que transforma a proposta do
 * fornecedor em OPÇÕES do item do orçamento.
 *
 * Roda nos dois lados: no servidor, quando o fornecedor envia (grava direto no
 * orçamento), e no formulário do orçamento, quando alguém está com ele aberto e
 * a resposta chegou depois (botão "Trazer para o orçamento"). Por isso não
 * importa nada de servidor.
 */

/** O que foi pedido, por item — retrato do orçamento no momento do envio. */
export interface CotacaoItem {
  /** Posição do item no orçamento quando a cotação saiu. */
  idx: number
  nome: string
  descricao: string
  /** Faixas de quantidade (ex.: 500, 1000, 2000). Sempre ao menos uma. */
  faixas: number[]
  /** Tem imagem de referência no orçamento (servida pelo link do fornecedor). */
  temImagem?: boolean
}

export interface RespostaPreco { quant: number; unit: number | null; total: number | null }
export interface RespostaItem { idx: number; nao_fornece: boolean; precos: RespostaPreco[]; obs: string }
export interface Resposta {
  itens: RespostaItem[]
  prazo_producao: string
  validade: string
  pgto: string
  n_orc: string
  observacao: string
}

export interface ArquivoRef { chave: string; nome: string }

/** Opção do item do orçamento (mesmo formato do OrcamentoForm). */
export interface OpcaoOrc {
  fornecedor_id: string; n_orc: string; pgto: string; quant: string
  valor_unit: string; valor_total?: string; selecionado: boolean
  /** Opção que veio de uma resposta de cotação — é a chave para não duplicar. */
  cotacao_convite_id?: string
}
export interface ItemOrcBase { nome: string; opcoes: OpcaoOrc[] }

export const MAX_FAIXAS = 4

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://flow.oneaone.com.br').replace(/\/$/, '')
/** Link público do fornecedor. */
export const urlCotacao = (token: string) => `${SITE_URL}/cotacao/${token}`

/** Número → "3.118,44" (formato que os inputs do orçamento usam). */
export const fmtBR = (v: number) => (isFinite(v) ? v : 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** Unitário guarda até 4 casas (1.398,60 ÷ 1000 = 1,3986) — mesma regra do orçamento. */
export const fmtBRUnit = (v: number) => (isFinite(v) ? v : 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })

/** Unitário e total de uma faixa: o que o fornecedor não digitou é derivado do outro. */
export function precoResolvido(p: RespostaPreco): { unit: number; total: number } | null {
  const q = p.quant > 0 ? p.quant : 0
  if (p.total != null && p.total > 0) return { total: p.total, unit: q ? p.total / q : p.unit ?? 0 }
  if (p.unit != null && p.unit > 0) return { unit: p.unit, total: p.unit * q }
  return null
}

/** Faixas digitadas ("500, 1000 2.000") → números inteiros positivos, sem repetição, em ordem. */
export function parseFaixas(texto: string): number[] {
  const nums = (texto.match(/\d[\d.]*/g) ?? [])
    .map(t => parseInt(t.replace(/\./g, ''), 10))
    .filter(n => Number.isFinite(n) && n > 0)
  return [...new Set(nums)].sort((a, b) => a - b).slice(0, MAX_FAIXAS)
}

const vazia = (o: OpcaoOrc) => !o.fornecedor_id && !o.valor_unit && !o.valor_total && !o.n_orc

/** Onde o item pedido está hoje no orçamento: mesma posição com o mesmo nome, senão pelo nome. */
function alvo(itens: ItemOrcBase[], pedido: CotacaoItem): number {
  const n = (s: string) => (s ?? '').trim().toLowerCase()
  if (itens[pedido.idx] && n(itens[pedido.idx].nome) === n(pedido.nome)) return pedido.idx
  const i = itens.findIndex(it => n(it.nome) === n(pedido.nome))
  return i >= 0 ? i : (itens[pedido.idx] ? pedido.idx : -1)
}

/**
 * Aplica a proposta de um fornecedor nos itens do orçamento: cada faixa com
 * preço vira uma opção. Reenvio do mesmo fornecedor SUBSTITUI as opções dele
 * (nunca duplica) e mantém escolhida a faixa que já estava escolhida. A linha
 * vazia que o orçamento cria por padrão sai quando a primeira resposta entra.
 */
export function aplicarResposta<T extends ItemOrcBase>(
  itens: T[], conviteId: string, fornecedorId: string, pedidos: CotacaoItem[], resposta: Resposta,
): T[] {
  const out = itens.map(it => ({ ...it, opcoes: [...it.opcoes] }))
  for (const r of resposta.itens) {
    const pedido = pedidos.find(p => p.idx === r.idx)
    if (!pedido) continue
    const i = alvo(out, pedido)
    if (i < 0) continue
    const antes = out[i].opcoes
    const escolhida = antes.find(o => o.cotacao_convite_id === conviteId && o.selecionado)?.quant
    const novas: OpcaoOrc[] = r.nao_fornece ? [] : r.precos.flatMap(p => {
      const v = precoResolvido(p)
      if (!v) return []
      const quant = String(p.quant || 1)
      return [{
        fornecedor_id: fornecedorId, n_orc: resposta.n_orc ?? '', pgto: resposta.pgto ?? '',
        quant, valor_unit: fmtBRUnit(v.unit), valor_total: fmtBR(v.total),
        selecionado: escolhida === quant, cotacao_convite_id: conviteId,
      }]
    })
    const mantidas = antes.filter(o => o.cotacao_convite_id !== conviteId && !(novas.length && vazia(o)))
    out[i].opcoes = [...mantidas, ...novas]
    if (!out[i].opcoes.length) {
      out[i].opcoes = [{ fornecedor_id: '', n_orc: '', pgto: '', quant: '1', valor_unit: '', valor_total: '', selecionado: false }]
    }
  }
  return out
}

/** A resposta já está refletida nos itens? (alguma opção com o id do convite, ou nada a trazer) */
export function respostaAplicada(itens: ItemOrcBase[], conviteId: string, resposta: Resposta | null): boolean {
  if (!resposta) return true
  const temPreco = resposta.itens.some(r => !r.nao_fornece && r.precos.some(p => precoResolvido(p)))
  if (!temPreco) return true
  return itens.some(it => it.opcoes.some(o => o.cotacao_convite_id === conviteId))
}

/** Status do convite para a lista (ordem = gravidade na leitura). */
export type ConviteStatus = 'respondeu' | 'recusou' | 'abriu' | 'enviado' | 'nao_enviado'
export function statusConvite(c: {
  respondido_em: string | null; recusado_em: string | null; aberto_em: string | null
  email_enviado_em: string | null; whatsapp_em: string | null
}): ConviteStatus {
  if (c.respondido_em) return 'respondeu'
  if (c.recusado_em) return 'recusou'
  if (c.aberto_em) return 'abriu'
  if (c.email_enviado_em || c.whatsapp_em) return 'enviado'
  return 'nao_enviado'
}

/** Texto da mensagem de WhatsApp (o link wa.me leva isto já digitado). */
export function textoWhatsApp(o: { agencia: string; fornecedor: string; titulo: string; prazo: string | null; url: string }): string {
  const prazo = o.prazo ? ` até ${o.prazo.split('-').reverse().join('/')}` : ''
  return `Olá, ${o.fornecedor}! Aqui é da ${o.agencia}. Estamos cotando "${o.titulo}" e gostaríamos da sua proposta${prazo}.\n\n`
    + `Pelo link abaixo você vê os itens e os anexos e envia os valores (e o seu arquivo, se preferir):\n${o.url}`
}
