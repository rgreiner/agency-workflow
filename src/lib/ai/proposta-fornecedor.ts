import 'server-only'
import { iaDaOrg, iaJson, iaDisponivel } from './provedor'

/**
 * Lê a PROPOSTA/ORÇAMENTO que um fornecedor mandou por fora (PDF ou foto, por
 * e-mail ou WhatsApp) e devolve o que a pessoa digitaria na cotação: quem é o
 * fornecedor, os itens com quantidades, variações e preços, e as condições.
 *
 * Medido em 26/10/2026: metade dos orçamentos (6 de ~12/mês) já passa pelo link
 * da cotação; a outra metade chega em PDF. Este leitor põe esses PDFs no mesmo
 * comparativo. O resultado é SUGESTÃO: a tela de conferência mostra tudo
 * editável e só grava o que a pessoa confirmar — preço errado em orçamento custa
 * caro (regra da casa: IA aponta, pessoa decide).
 */

export interface PropostaLinhaLida { variante: string; quant: number; unit: number | null; total: number | null }
export interface PropostaItemLido { nome: string; descricao: string; obs: string; linhas: PropostaLinhaLida[] }
export interface PropostaLida {
  model: string
  fornecedor: { nome: string; cnpj: string; email: string; telefone: string; contato: string }
  n_orc: string
  prazo_producao: string
  validade: string
  pgto: string
  observacao: string
  itens: PropostaItemLido[]
}

const SYSTEM = `Você lê a PROPOSTA COMERCIAL / ORÇAMENTO que um FORNECEDOR mandou para uma agência de publicidade (gráfica, brindes, comunicação visual, fotografia, vídeo…) e devolve os dados em JSON.

FORNECEDOR (quem EMITIU a proposta, nunca a agência nem o cliente dela)
- nome: nome fantasia ou razão social do fornecedor, como impresso no cabeçalho.
- cnpj: só dígitos. telefone: como impresso. email: o do fornecedor. contato: nome do vendedor/atendente, se houver.

ITENS
- Um item por PRODUTO/SERVIÇO cotado (ex.: "Flyer A5", "Caneta metálica", "Banner 1x2m").
- nome: curto, como o produto é chamado. descricao: especificação técnica (formato, papel, cores, acabamento) resumida.
- obs: observação do fornecedor sobre ESTE item (ex.: "valor com gravação a laser").
- linhas: uma linha por combinação de QUANTIDADE e VARIAÇÃO com preço.
  - variante: o que muda entre opções do MESMO item (papel, gramatura, material, acabamento, tamanho). Ex.: "Couchê 120g", "Sulfite 90g". "" quando só há uma opção.
  - quant: a quantidade (número inteiro). Serviço sem quantidade = 1.
  - unit: preço UNITÁRIO; total: preço TOTAL daquela quantidade. Copie os que estiverem impressos; o que não estiver, 0. Não calcule nem arredonde.
- Tabela de preços por faixa (500 / 1.000 / 2.000 un.) = uma linha para cada faixa.
- Não crie item para frete, impostos ou taxas — isso vai em observacao.

CONDIÇÕES (da proposta inteira)
- n_orc: número da proposta/orçamento do fornecedor.
- prazo_producao: prazo de produção/entrega, como escrito (ex.: "10 dias úteis").
- validade: validade da proposta, como escrita.
- pgto: condição de pagamento, como escrita.
- observacao: frete, impostos inclusos ou não, condições gerais — resumido, sem repetir o que já está nos itens.

NÚMEROS
- Ponto decimal, sem "R$" e sem separador de milhar: "1.234,50" vira 1234.5.

TODOS OS CAMPOS SÃO OBRIGATÓRIOS
- Dado que o documento não mostra: "" (texto) ou 0 (número). Nunca omita o campo. Chute é pior que vazio.`

const SCHEMA = {
  type: 'object',
  properties: {
    fornecedor: {
      type: 'object',
      properties: { nome: { type: 'string' }, cnpj: { type: 'string' }, email: { type: 'string' }, telefone: { type: 'string' }, contato: { type: 'string' } },
      required: ['nome', 'cnpj', 'email', 'telefone', 'contato'],
    },
    n_orc: { type: 'string' },
    prazo_producao: { type: 'string' },
    validade: { type: 'string' },
    pgto: { type: 'string' },
    observacao: { type: 'string' },
    itens: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nome: { type: 'string' },
          descricao: { type: 'string' },
          obs: { type: 'string' },
          linhas: {
            type: 'array',
            items: {
              type: 'object',
              properties: { variante: { type: 'string' }, quant: { type: 'number' }, unit: { type: 'number' }, total: { type: 'number' } },
              required: ['variante', 'quant', 'unit', 'total'],
            },
          },
        },
        required: ['nome', 'descricao', 'obs', 'linhas'],
      },
    },
  },
  // Todos obrigatórios: com campo opcional o Gemini omite o que não quer preencher
  // (medido em 09/10/2026 na leitura de NF — ver nf-fornecedor.ts).
  required: ['fornecedor', 'n_orc', 'prazo_producao', 'validade', 'pgto', 'observacao', 'itens'],
} as const

const txt = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/\./g, '').replace(',', '.')) : NaN
  return Number.isFinite(n) && n > 0 && n < 1e10 ? n : null
}

export async function lerPropostaFornecedor(orgId: string, arquivo: { bytes: Buffer; mimeType: string }): Promise<PropostaLida | null> {
  const cfg = await iaDaOrg(orgId)
  if (!iaDisponivel(cfg)) return null

  const { model, data: d } = await iaJson<Record<string, unknown>>(cfg, {
    system: SYSTEM,
    parts: [
      { kind: 'media', mimeType: arquivo.mimeType, base64: arquivo.bytes.toString('base64') },
      { kind: 'text', text: 'Leia esta proposta de fornecedor.' },
    ],
    schema: SCHEMA,
    // Proposta com tabela de faixas gera JSON maior que a NF, e o modelo pensa antes
    // no mesmo orçamento de tokens (ver nf-fornecedor.ts: 2048 vinha vazio).
    maxOutputTokens: 16384,
    timeoutMs: 90_000,
  })
  if (!d) return null

  const f = (d.fornecedor ?? {}) as Record<string, unknown>
  const itens = (Array.isArray(d.itens) ? d.itens : []).map((x: unknown) => {
    const it = (x ?? {}) as Record<string, unknown>
    const linhas = (Array.isArray(it.linhas) ? it.linhas : []).flatMap((y: unknown) => {
      const l = (y ?? {}) as Record<string, unknown>
      const q = Math.round(Number(l.quant) || 0)
      const unit = num(l.unit), total = num(l.total)
      if (!unit && !total) return []
      return [{ variante: txt(l.variante, 80), quant: q > 0 ? q : 1, unit, total }]
    })
    return { nome: txt(it.nome, 200), descricao: txt(it.descricao, 1000), obs: txt(it.obs, 1000), linhas }
  }).filter(it => it.nome && it.linhas.length)

  return {
    model,
    fornecedor: {
      nome: txt(f.nome, 200), cnpj: txt(f.cnpj, 30).replace(/\D/g, ''), email: txt(f.email, 200).toLowerCase(),
      telefone: txt(f.telefone, 40), contato: txt(f.contato, 120),
    },
    n_orc: txt(d.n_orc, 60), prazo_producao: txt(d.prazo_producao, 200), validade: txt(d.validade, 200),
    pgto: txt(d.pgto, 200), observacao: txt(d.observacao, 3000),
    itens,
  }
}
