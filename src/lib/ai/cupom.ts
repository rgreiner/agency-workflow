import 'server-only'
import { iaDaOrg, iaJson, iaDisponivel } from './provedor'

/**
 * Lê um cupom fiscal / NF anexada a um lançamento e devolve os ITENS.
 *
 * Serve à pergunta do Rafael (29/09/2026): onde há desperdício e recorrência no
 * consumo da casa (café, papel, limpeza) e o que explica um pico no mês. Por
 * isso o item traz quantidade e valor unitário: sem o unitário não dá para
 * separar "compramos mais" de "ficou mais caro", que é a pergunta de verdade.
 *
 * O que esta função NÃO faz: mexer no lançamento. Valor, categoria e conciliação
 * seguem sendo a verdade contábil; o item é camada de leitura.
 */

export interface ItemLido {
  descricao: string
  produto: string | null
  quantidade: number | null
  unidade: string | null
  valor_unitario: number | null
  valor_total: number
}

export interface CupomLido {
  model: string
  itens: ItemLido[]
  /** Total impresso no documento (para conferir contra o lançamento). */
  total_documento: number | null
  emitente: string | null
}

const SYSTEM = `Você lê cupom fiscal (NFC-e), nota fiscal e recibo de compra e devolve os ITENS.

REGRA 1 — TRANSCREVER, NÃO INTERPRETAR
- Copie cada linha de produto como está impressa, em "descricao".
- Não invente item, não junte dois itens numa linha, não divida um item em dois.
- Item ilegível: transcreva o que dá e deixe os números em null. Chute é pior que vazio.

REGRA 2 — NÚMEROS
- "valor_total" é o valor da LINHA (quantidade × unitário, já com desconto da linha).
- "quantidade" e "valor_unitario" só quando o documento os mostra. Não calcule
  o unitário dividindo se a quantidade não estiver impressa.
- Use ponto decimal. Nada de "R$", milhar ou texto nos campos numéricos.

REGRA 3 — O QUE NÃO É ITEM
- Ignore subtotal, total, troco, desconto geral, acréscimo, forma de pagamento,
  tributos totalizados ("Trib aprox"), dados do emitente e mensagem fiscal.
- Sacola/embalagem cobrada É item.

REGRA 4 — "produto": o nome LIMPO para agrupar no histórico
- O cupom abrevia: "PAPEL HIG NEVE F/D L12P10", "CAFE MELITTA TRAD 500G",
  "DET YPE NEUTRO 500ML". "produto" é o nome genérico que se repete entre compras:
  "Papel higiênico", "Café", "Detergente".
- Sem marca, sem tamanho, sem código. É o que vai virar a série do ano.
- Não deu para entender o que é: "produto" fica null. A pessoa classifica depois.

REGRA 5 — total_documento
- O total impresso no documento, quando houver. Serve só para conferência.

REGRA 6 — VÁRIAS IMAGENS SÃO UM DOCUMENTO SÓ
- Quando vierem várias imagens, elas são partes do MESMO cupom fotografado em
  pedaços, e os pedaços SE SOBREPÕEM (a mesma linha aparece em duas fotos).
- Devolva uma lista única. Uma linha que aparece em duas fotos entra UMA vez.
- Atenção: item repetido de verdade existe (6 desinfetantes iguais, um por linha).
  O que distingue: no cupom real cada compra tem sua linha em sequência; a
  sobreposição repete o mesmo trecho do cupom, com os vizinhos iguais.
- "total_documento" é o total final do cupom, que aparece em uma das fotos —
  não some os subtotais de cada foto.`

const SCHEMA = {
  type: 'object',
  properties: {
    emitente: { type: 'string' },
    total_documento: { type: 'number' },
    itens: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          descricao: { type: 'string' },
          produto: { type: 'string' },
          quantidade: { type: 'number' },
          unidade: { type: 'string' },
          valor_unitario: { type: 'number' },
          valor_total: { type: 'number' },
        },
        required: ['descricao', 'valor_total'],
      },
    },
  },
  required: ['itens'],
} as const

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN
  return Number.isFinite(n) ? n : null
}
const txt = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s || null
}

interface Cru { emitente?: unknown; total_documento?: unknown; itens?: unknown }

/**
 * `null` quando a org não tem nenhuma IA utilizável.
 *
 * Recebe TODOS os arquivos da compra numa chamada só: cupom de mercado é longo e
 * chega fotografado em pedaços (a compra de 21/09 veio em 3 fotos). Uma chamada
 * por foto devolveria três listas parciais e sobrepostas, e a soma estouraria o
 * total — foi o que o teste em produção mostrou.
 */
export async function lerCupom(orgId: string, arquivos: { bytes: Buffer; mimeType: string }[]): Promise<CupomLido | null> {
  const cfg = await iaDaOrg(orgId)
  if (!iaDisponivel(cfg)) return null
  if (arquivos.length === 0) return null

  const { model, data } = await iaJson<Cru>(cfg, {
    system: SYSTEM,
    parts: [
      ...arquivos.map(a => ({ kind: 'media' as const, mimeType: a.mimeType, base64: a.bytes.toString('base64') })),
      { kind: 'text', text: arquivos.length > 1
        ? `São ${arquivos.length} fotos do MESMO cupom, em pedaços que se sobrepõem. Devolva uma lista única, sem repetir linha que aparece em duas fotos.`
        : 'Liste os itens deste documento.' },
    ],
    schema: SCHEMA,
    // Medido em produção (29/09): 3 fotos de um cupom de mercado = 29 itens,
    // 2.223 tokens de resposta e 4.297 SÓ de pensamento, que sai do mesmo
    // orçamento. Com 8192 o JSON vinha cortado no meio — e JSON cortado é
    // "não achou itens", silencioso e errado.
    maxOutputTokens: 16384,
    timeoutMs: 90_000,
  })

  const brutos = Array.isArray(data?.itens) ? data.itens : []
  const itens: ItemLido[] = brutos
    .map(raw => {
      const o = (raw ?? {}) as Record<string, unknown>
      const total = num(o.valor_total)
      const descricao = txt(o.descricao)
      if (!descricao || total === null) return null
      return {
        descricao,
        produto: txt(o.produto),
        quantidade: num(o.quantidade),
        unidade: txt(o.unidade),
        valor_unitario: num(o.valor_unitario),
        valor_total: total,
      }
    })
    .filter((x): x is ItemLido => x !== null)

  return { model, itens, total_documento: num(data?.total_documento), emitente: txt(data?.emitente) }
}
