import 'server-only'
import type { DriveAsset } from '@/lib/google-drive'
import type { IAPart } from './gemini'
import { iaDisponivel, iaJson } from './provedor'
import type { RevisaoConfig } from './revisao-config'

/**
 * Motor da Revisão IA, multimodal (texto + imagens/PDF). Roda sob demanda, pelo
 * botão "Revisar" da tarefa, com o provedor/modelo/chave que a org cadastrou em
 * Configurações → Revisão IA. A saída é só a lista de apontamentos — trecho +
 * correção curta —, sem explicação: quem decide o que corrigir é a pessoa.
 */

export interface ReviewError {
  /** Trecho exato como aparece no material. */
  trecho: string
  /** Correção curta ("Casa com s e não z."). */
  correcao: string
}

export interface ReviewResult {
  model: string
  errors: ReviewError[]
  /** Entrada foi cortada por exceder o limite enviado ao modelo. */
  truncated: boolean
}

// Limite de caracteres de texto enviados ao modelo (controla custo/latência). ~12-16 páginas.
const MAX_CHARS = 40000

// ── Prompt ──────────────────────────────────────────────────────────────────

const REGRAS = `Aponte APENAS o que for erro CLARO:
- ortografia e acentuação
- gramática: concordância, regência, crase
- pontuação que cause erro real
- incoerência objetiva: a mesma informação diferente em dois lugares (data, preço, nome,
  medida, teor, volume), palavra trocada ou faltando que deixa a frase sem sentido.

NÃO aponte: estilo, tom, vírgula opcional, gíria, informalidade, neologismo publicitário,
nome de marca, hashtag, CTA, maiúsculas de título, quebra de linha, diagramação.
Na dúvida entre erro e escolha de quem escreveu, NÃO aponte.

Formato de cada apontamento:
- "trecho": o trecho exato, curto, copiado como está no material.
- "correcao": a correção em UMA frase curta (até 12 palavras), sem explicar a regra.
  Exemplo: trecho "A sua caza é bonita" → correcao "Casa com s e não z."
Um apontamento por erro; não repita o mesmo trecho. Sem nenhum erro claro, lista vazia.`

const SYSTEM_TEXTO = `Você revisa textos publicitários em português do Brasil.\n\n${REGRAS}`

const SYSTEM_PECAS = `Você revisa o texto VISÍVEL em peças publicitárias (imagens/PDF) em português do Brasil.\n\n${REGRAS}`

const SYSTEM_PECAS_COM_TEXTO = `${SYSTEM_PECAS}

Você também recebe o TEXTO APROVADO pela Redação. Além dos erros de língua, aponte quando
a peça DIVERGE do texto aprovado de forma relevante: trecho faltando, trocado ou com
informação diferente (ex.: dado de um produto usado no rótulo de outro), ou página/peça
prevista que não veio. Nesses casos "trecho" é o que está na peça (ou o nome da peça
faltante) e "correcao" é o que deveria estar, em poucas palavras.`

const SCHEMA = {
  type: 'object',
  properties: {
    erros: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          trecho:   { type: 'string' },
          correcao: { type: 'string' },
        },
        required: ['trecho', 'correcao'],
        additionalProperties: false,
      },
    },
  },
  required: ['erros'],
  additionalProperties: false,
}

// ── Entradas ────────────────────────────────────────────────────────────────

function cortar(txt: string): { texto: string; truncated: boolean } {
  const t = (txt ?? '').trim()
  return t.length > MAX_CHARS ? { texto: t.slice(0, MAX_CHARS), truncated: true } : { texto: t, truncated: false }
}

/** Revisão de um texto puro (Redação). */
export async function reviewText(cfg: RevisaoConfig, text: string): Promise<ReviewResult> {
  const { texto, truncated } = cortar(text)
  const { model, list } = await run(cfg, SYSTEM_TEXTO, [
    { kind: 'text', text: `--- INÍCIO DO TEXTO ---\n${texto}\n--- FIM DO TEXTO ---` },
  ])
  return { model, errors: list, truncated }
}

/**
 * Revisão das peças (Design/Finalização). Com o texto aprovado da Redação, a
 * mesma chamada também confere se a peça usou o texto certo.
 */
export async function reviewArtwork(cfg: RevisaoConfig, assets: DriveAsset[], textoAprovado?: string): Promise<ReviewResult> {
  const { texto, truncated } = cortar(textoAprovado ?? '')
  const parts: IAPart[] = []
  if (texto) parts.push({ kind: 'text', text: `TEXTO APROVADO PELA REDAÇÃO:\n--- INÍCIO ---\n${texto}\n--- FIM ---\n\nPeças:` })
  for (const a of assets) parts.push({ kind: 'media', mimeType: a.mimeType, base64: a.base64 })
  const { model, list } = await run(cfg, texto ? SYSTEM_PECAS_COM_TEXTO : SYSTEM_PECAS, parts)
  return { model, errors: list, truncated }
}

// ── Execução ────────────────────────────────────────────────────────────────

async function run(cfg: RevisaoConfig, system: string, parts: IAPart[]): Promise<{ model: string; list: ReviewError[] }> {
  // Claude exige chave cadastrada; Gemini sem chave usa a do ambiente, se houver.
  if (!iaDisponivel(cfg) || (cfg.provider === 'anthropic' && !cfg.apiKey)) throw new Error('SEM_CHAVE')
  const { model, data } = await iaJson<{ erros?: unknown }>(cfg, {
    system, parts, schema: SCHEMA, maxOutputTokens: 16384, timeoutMs: 120_000,
  })
  return { model, list: normalizar(data?.erros) }
}

function normalizar(value: unknown): ReviewError[] {
  if (!Array.isArray(value)) return []
  const vistos = new Set<string>()
  const out: ReviewError[] = []
  for (const e of value) {
    const o = (e ?? {}) as Record<string, unknown>
    const trecho = String(o.trecho ?? '').trim().slice(0, 300)
    const correcao = String(o.correcao ?? o.sugestao ?? '').trim().slice(0, 200)
    if (!trecho || !correcao) continue
    // O modelo às vezes repete o mesmo apontamento (medido em 26/09: 5× o mesmo).
    const chave = `${trecho.toLowerCase()}|${correcao.toLowerCase()}`
    if (vistos.has(chave)) continue
    // "Correção" igual ao trecho não é apontamento.
    if (correcao.toLowerCase() === trecho.toLowerCase()) continue
    vistos.add(chave)
    out.push({ trecho, correcao })
  }
  return out
}

/**
 * Motivo da falha em pt-BR, apontando para onde se resolve. Vale para toda IA
 * que usa a chave da org (revisão, briefing, folha, guia) — `fallback` é o
 * recado quando o motivo não é reconhecido.
 */
export function mensagemErroRevisao(
  e: unknown,
  provider: RevisaoConfig['provider'],
  fallback = 'A revisão não pôde ser concluída. O erro foi registrado para o administrador.',
): string {
  const bruto = (e instanceof Error ? e.message : String(e ?? '')).toLowerCase()
  const status = typeof (e as { status?: unknown } | null)?.status === 'number' ? (e as { status: number }).status : null
  const conta = provider === 'anthropic' ? 'na conta da Anthropic (console.anthropic.com → Billing)' : 'no Google AI Studio (Billing)'
  if (bruto === 'sem_chave') return 'Nenhuma chave de IA cadastrada. Um administrador cadastra em Configurações → Revisão IA.'
  if (/credit|billing|prepay|depleted|quota|exceeded/.test(bruto)) return `A IA está sem créditos ou sem cota. Um administrador precisa conferir ${conta}.`
  // Só erro de CHAVE aqui. Até 28/09 qualquer "invalid" caía nesta frase — e um
  // 400 de formato do pedido virou "chave recusada" com a chave certa.
  if (status === 401 || status === 403 || /api key not valid|api_key_invalid|x-api-key|authentication_error|permission_denied|denied access/.test(bruto)) {
    return 'A chave da IA foi recusada. Um administrador precisa conferir em Configurações → Revisão IA.'
  }
  if (status === 404 || /not_found|not found|no longer available/.test(bruto)) return 'O modelo escolhido não está disponível. Troque o modelo em Configurações → Revisão IA.'
  if (status === 429 || status === 529 || (status ?? 0) >= 500 || /overloaded|high demand|unavailable|rate limit/.test(bruto)) {
    return 'A IA está sobrecarregada agora. Tente de novo em instantes.'
  }
  if (/timeout|tempo esgotado|timed out/.test(bruto)) return 'A IA demorou demais para responder. Tente de novo em instantes.'
  return fallback
}
