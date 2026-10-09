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
- valor_total: o valor LÍQUIDO a pagar. Ponto decimal, sem "R$" nem separador de milhar.
- descricao: uma linha curta do serviço/produto, como está na discriminação. Em cupom de mercado, resuma o tipo de compra ("Compras de mercado", "Combustível"), não liste itens.
- pago_no_ato: true para cupom fiscal e recibo (a compra foi paga na hora); false para nota com vencimento e boleto.
- categoria: escolha UMA da lista de categorias informada na mensagem, copiando o nome exatamente. Se nenhuma servir com segurança, null. Não invente categoria fora da lista.

CUIDADOS
- Nota tem DOIS CNPJs: o do prestador e o do tomador. Devolva o do PRESTADOR (quem está cobrando).
- Quando houver "valor líquido" e "valor bruto" diferentes (retenções), devolva o LÍQUIDO a pagar.
- Campo que o documento não mostra fica null. Chute é pior que vazio: o valor errado vira despesa errada.
- Se o documento for um BOLETO e não uma nota, leia o que der (valor, vencimento, beneficiário) e deixe o resto null.
- Várias imagens são partes do MESMO documento fotografado em pedaços: devolva um cabeçalho só, com o total final (não some subtotais de fotos diferentes).`

const SCHEMA = {
  type: 'object',
  properties: {
    emitente: { type: 'string' },
    cnpj: { type: 'string' },
    numero: { type: 'string' },
    emissao: { type: 'string' },
    vencimento: { type: 'string' },
    valor_total: { type: 'number' },
    descricao: { type: 'string' },
    pago_no_ato: { type: 'boolean' },
    categoria: { type: 'string' },
  },
  required: [],
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
    // Cabeçalho é resposta curta; o orçamento grande do cupom (16k) existia por
    // causa da lista de itens, que aqui não existe.
    maxOutputTokens: 2048,
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
