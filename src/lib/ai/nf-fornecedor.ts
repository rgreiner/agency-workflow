import 'server-only'
import { iaDaOrg, iaJson, iaDisponivel } from './provedor'

/**
 * Lê o CABEÇALHO de uma nota fiscal recebida de fornecedor.
 *
 * É o irmão de `lerCupom`, com objetivo oposto: o cupom é lido para detalhar uma
 * compra que JÁ virou lançamento; aqui o documento é lido para CRIAR a despesa
 * (tela Financeiro → Lançar despesa). Por isso não interessam os itens e sim
 * quem emitiu, quanto, quando vence e qual o número — o que alguém digitaria à
 * mão. Serve para NF de serviço, DANFE, cupom fiscal de mercado e boleto.
 *
 * Nenhum fornecedor manda XML: medido em 03/10/2026, os 214 anexos de despesa
 * são PDF (205) ou foto (9), zero XML. Então é leitura por IA mesmo, e o valor
 * lido é SUGESTÃO — quem confirma é a pessoa, porque despesa errada contamina
 * margem e fluxo de caixa de uma vez.
 */

export interface NfFornecedorLida {
  model: string
  emitente: string | null
  cnpj: string | null
  numero: string | null
  emissao: string | null
  vencimento: string | null
  valor_total: number | null
  descricao: string | null
  /**
   * O que a PESSOA marcou como despesa da empresa: valor escrito à mão no papel
   * ou soma dos itens grifados. É assim que o financeiro trabalha — medido em
   * cupons reais (09/10/2026): grifa a parte da empresa e escreve o subtotal.
   */
  valor_marcado: number | null
  criterio_marcado: 'manuscrito' | 'grifado' | null
  /** Quantos documentos DIFERENTES vieram nas imagens (dois cupons ≠ um em pedaços). */
  documentos: number
  /** Cupom fiscal / recibo = compra já paga no ato; NF e boleto costumam vencer depois. */
  pago_no_ato: boolean
  /** Uma das categorias da org, ou null. Sugestão — quem confirma é a pessoa. */
  categoria: string | null
}

const SYSTEM = `Você lê um documento de DESPESA da empresa — nota fiscal (NFS-e de serviço, NF-e, DANFE), cupom fiscal (NFC-e de mercado, posto, restaurante), recibo ou boleto — e devolve o CABEÇALHO.

O QUE DEVOLVER
- emitente: razão social de QUEM EMITIU a nota (o prestador/fornecedor), nunca o tomador.
- cnpj: CNPJ do emitente, só dígitos.
- numero: o número da nota, como impresso.
- emissao: data de emissão, AAAA-MM-DD.
- vencimento: data de vencimento, AAAA-MM-DD. Só se o documento disser; não deduza da emissão.
- valor_total: o valor LÍQUIDO a pagar — o TOTAL final do documento, depois de descontos. Em cupom, é a linha de total/valor a pagar, não um item. Ponto decimal, sem "R$" nem separador de milhar.
- descricao: uma linha curta do serviço/produto, como está na discriminação. Em cupom de mercado, resuma o tipo de compra ("Compras de mercado", "Combustível"), não liste itens.
- valor_marcado: o que a PESSOA marcou no papel como despesa da empresa. Ordem de prioridade:
  1. um valor ESCRITO À MÃO no documento (ex.: "R$ 66,84" de caneta) → é ele;
  2. senão, itens GRIFADOS com marca-texto → a SOMA dos valores totais desses itens;
  3. senão, 0.
- criterio_marcado: "manuscrito", "grifado" ou "" — de onde saiu o valor_marcado.
- documentos: quantos documentos DIFERENTES vieram (veja VÁRIAS IMAGENS).
- pago_no_ato: true para cupom fiscal e recibo (a compra foi paga na hora); false para nota com vencimento e boleto.
- categoria: escolha UMA da lista de categorias informada na mensagem, copiando o nome exatamente. Se nenhuma servir com segurança, null. Não invente categoria fora da lista.

TODOS OS CAMPOS SÃO OBRIGATÓRIOS NA RESPOSTA
- Quando o documento não mostra um dado, devolva "" (texto vazio) ou 0 (número). Nunca omita o campo.

DATAS
- Ano com 2 dígitos é deste século: "25/09/26" é 2026-09-25. Nunca troque o ano por outro.
- Cupom fiscal costuma trazer só a data e hora da compra: ela é a "emissao".

CUIDADOS
- Nota tem DOIS CNPJs: o do prestador e o do tomador. Devolva o do PRESTADOR (quem está cobrando).
- Quando houver "valor líquido" e "valor bruto" diferentes (retenções), devolva o LÍQUIDO a pagar.
- Campo que o documento não mostra fica null. Chute é pior que vazio: o valor errado vira despesa errada.
- Se o documento for um BOLETO e não uma nota, leia o que der (valor, vencimento, beneficiário) e deixe o resto null.
VÁRIAS IMAGENS
- Podem ser o MESMO documento fotografado em pedaços (mesmo emitente, data e número; trechos que se repetem) OU documentos DIFERENTES (emitente, CNPJ, data ou número diferentes — ex.: dois cupons de lojas diferentes).
- Mesmo documento em pedaços: um cabeçalho só, documentos = 1, total final (não some subtotais de fotos diferentes).
- Documentos diferentes: documentos = quantos são; emitente, cnpj, numero e emissao do PRIMEIRO; valor_total = SOMA dos totais; valor_marcado = SOMA do que foi marcado em cada um (manuscrito de um + grifados do outro, se for o caso).`

const SCHEMA = {
  type: 'object',
  properties: {
    emitente: { type: 'string' },
    cnpj: { type: 'string' },
    numero: { type: 'string' },
    emissao: { type: 'string' },
    vencimento: { type: 'string' },
    valor_total: { type: 'number' },
    valor_marcado: { type: 'number' },
    criterio_marcado: { type: 'string' },
    documentos: { type: 'number' },
    descricao: { type: 'string' },
    pago_no_ato: { type: 'boolean' },
    categoria: { type: 'string' },
  },
  // Todos obrigatórios. Com campos opcionais o Gemini OMITE o que não quer
  // preencher: medido em 09/10/2026 com documentos reais, ele terminava normal
  // (STOP) devolvendo só 3–4 campos em ~60 tokens — sem valor, sem data. Vazio
  // ("" ou 0) é tratado como ausente pelos conversores abaixo.
  required: ['emitente', 'cnpj', 'numero', 'emissao', 'vencimento', 'valor_total', 'valor_marcado', 'criterio_marcado', 'documentos', 'descricao', 'pago_no_ato', 'categoria'],
} as const

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/\./g, '').replace(',', '.')) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}
const txt = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s || null
}
/** Data só vale se vier no formato combinado — "15/03" viraria lixo na coluna date. */
const data = (v: unknown): string | null => {
  const s = txt(v)
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

export async function lerNfFornecedor(
  orgId: string, arquivos: { bytes: Buffer; mimeType: string }[],
  /** Categorias de DESPESA da org — a IA só pode escolher entre elas. */
  categorias: string[] = [],
): Promise<NfFornecedorLida | null> {
  const cfg = await iaDaOrg(orgId)
  if (!iaDisponivel(cfg)) return null
  if (arquivos.length === 0) return null

  const { model, data: d } = await iaJson<Record<string, unknown>>(cfg, {
    system: SYSTEM,
    parts: [
      ...arquivos.map(a => ({ kind: 'media' as const, mimeType: a.mimeType, base64: a.bytes.toString('base64') })),
      { kind: 'text', text: [
        arquivos.length > 1
          ? `São ${arquivos.length} imagens do MESMO documento. Leia o cabeçalho dele.`
          : 'Leia o cabeçalho deste documento.',
        categorias.length
          ? `Categorias de despesa disponíveis (escolha no máximo uma, nome exato):\n${categorias.map(c => `- ${c}`).join('\n')}`
          : 'Não há lista de categorias: devolva categoria null.',
      ].join('\n\n') },
    ],
    schema: SCHEMA,
    // A RESPOSTA é curta (~60 tokens), mas o modelo PENSA antes, e o pensamento
    // sai do mesmo orçamento: medido em documentos reais, 1,7k a 5,5k tokens.
    // Com 2048 o JSON vinha vazio. Mesmo teto do cupom; paga-se o que se usa.
    maxOutputTokens: 16384,
    timeoutMs: 60_000,
  })

  return {
    model,
    emitente: txt(d?.emitente),
    cnpj: (txt(d?.cnpj) ?? '').replace(/\D/g, '') || null,
    numero: txt(d?.numero),
    emissao: data(d?.emissao),
    vencimento: data(d?.vencimento),
    valor_total: num(d?.valor_total),
    descricao: txt(d?.descricao),
    valor_marcado: num(d?.valor_marcado),
    criterio_marcado: d?.criterio_marcado === 'manuscrito' || d?.criterio_marcado === 'grifado'
      ? d.criterio_marcado : null,
    documentos: Math.max(1, Math.round(Number(d?.documentos) || 1)),
    pago_no_ato: d?.pago_no_ato === true,
    // Só vale se for EXATAMENTE uma da lista: categoria inventada pela IA viraria
    // uma folha nova na árvore, criada por ninguém.
    categoria: (() => {
      const c = txt(d?.categoria)
      if (!c) return null
      return categorias.find(x => x === c) ?? categorias.find(x => x.toLowerCase() === c.toLowerCase()) ?? null
    })(),
  }
}
