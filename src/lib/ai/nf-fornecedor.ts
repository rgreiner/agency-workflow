import 'server-only'
import { iaDaOrg, iaJson, iaDisponivel } from './provedor'

/**
 * Lê o CABEÇALHO de uma nota fiscal recebida de fornecedor.
 *
 * É o irmão de `lerCupom`, com objetivo oposto: o cupom é lido para detalhar uma
 * compra que JÁ virou lançamento; aqui a nota é lida para CRIAR a despesa. Por
 * isso não interessam os itens e sim quem emitiu, quanto, quando vence e qual o
 * número — o que alguém digitaria à mão.
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
}

const SYSTEM = `Você lê uma NOTA FISCAL (NFS-e de serviço, NF-e, DANFE ou recibo) recebida de um fornecedor e devolve o CABEÇALHO.

O QUE DEVOLVER
- emitente: razão social de QUEM EMITIU a nota (o prestador/fornecedor), nunca o tomador.
- cnpj: CNPJ do emitente, só dígitos.
- numero: o número da nota, como impresso.
- emissao: data de emissão, AAAA-MM-DD.
- vencimento: data de vencimento, AAAA-MM-DD. Só se o documento disser; não deduza da emissão.
- valor_total: o valor LÍQUIDO a pagar. Ponto decimal, sem "R$" nem separador de milhar.
- descricao: uma linha curta do serviço/produto, como está na discriminação.

CUIDADOS
- Nota tem DOIS CNPJs: o do prestador e o do tomador. Devolva o do PRESTADOR (quem está cobrando).
- Quando houver "valor líquido" e "valor bruto" diferentes (retenções), devolva o LÍQUIDO a pagar.
- Campo que o documento não mostra fica null. Chute é pior que vazio: o valor errado vira despesa errada.
- Se o documento for um BOLETO e não uma nota, leia o que der (valor, vencimento, beneficiário) e deixe o resto null.`

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
): Promise<NfFornecedorLida | null> {
  const cfg = await iaDaOrg(orgId)
  if (!iaDisponivel(cfg)) return null
  if (arquivos.length === 0) return null

  const { model, data: d } = await iaJson<Record<string, unknown>>(cfg, {
    system: SYSTEM,
    parts: [
      ...arquivos.map(a => ({ kind: 'media' as const, mimeType: a.mimeType, base64: a.bytes.toString('base64') })),
      { kind: 'text', text: 'Leia o cabeçalho desta nota fiscal.' },
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
  }
}
