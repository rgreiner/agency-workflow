import 'server-only'
import type { DriveAsset } from '@/lib/google-drive'
import { geminiConfigured, geminiJson, type IAPart } from './gemini'

/**
 * Motor de revisão por IA, MULTIMODAL (texto + imagens/PDF). Provedor único:
 * Gemini — ver lib/ai/gemini.ts para backend (AI Studio × Vertex) e modelo.
 * A saída é estruturada por schema fixo, nunca texto livre.
 */

export type ReviewProvider = 'gemini'

export interface ReviewError {
  /** Trecho exato onde está o erro/divergência. */
  trecho: string
  /** O que está errado. */
  problema: string
  /** Correção sugerida. */
  sugestao: string
  /** ortografia | gramatica | concordancia | regencia | pontuacao | conteudo | pagina | outro */
  tipo?: string
}

export interface ReviewResult {
  provider: ReviewProvider
  model: string
  clean: boolean
  errors: ReviewError[]
  /** Entrada foi truncada por exceder o limite enviado ao modelo. */
  truncated: boolean
}

/** Parte de entrada multimodal (texto ou peça). */
export type ReviewPart = IAPart

// Limite de caracteres de texto enviados ao modelo (controla custo/latência). ~12-16 páginas.
const MAX_CHARS = 40000

// ── Prompts ─────────────────────────────────────────────────────────────────

const SPELL_RULES = `Aponte APENAS erros CLAROS e objetivos de língua:
- ortografia / acentuação
- gramática (regência, crase, colocação)
- concordância (verbal e nominal)
- pontuação que cause erro real

REGRAS IMPORTANTES (evitam falso positivo):
- NÃO sugira reescritas de estilo, NÃO mude o tom nem a voz do texto.
- NÃO marque gírias, informalidades, neologismos publicitários, nomes de marca,
  hashtags, CTAs ou escolhas estilísticas como erro — podem ser intencionais.
- Na dúvida entre "erro" e "escolha do redator/designer", NÃO reporte.
- Quem decide o que é proposital é a pessoa; você só lista o que é erro evidente.

Para cada erro informe: o trecho exato, o problema e a correção.
Liste TODOS os erros claros que encontrar, do começo ao fim do material — não pare
nos primeiros nem resuma; é melhor varrer tudo de uma vez do que apontar aos poucos.
Se não houver nenhum erro claro, retorne a lista vazia.`

const SYSTEM_TEXT_SPELL =
  `Você é um revisor de português (pt-BR) de textos publicitários.\n\n${SPELL_RULES}`

const SYSTEM_ART_SPELL =
  `Você é um revisor de português (pt-BR) de PEÇAS publicitárias finalizadas (imagens/PDF).
Revise o texto VISÍVEL nas peças anexadas.\n\n${SPELL_RULES}
Ao citar um erro, transcreva o trecho exatamente como aparece na peça e, se possível,
indique em qual peça/página ele está.`

const SYSTEM_CROSSCHECK =
  `Você confere se as PEÇAS de design usaram corretamente o TEXTO APROVADO pelo redator.

Tarefas:
1. CONTEÚDO: verifique se o texto aprovado foi usado nas peças — sinalize trechos do
   texto aprovado que estão FALTANDO, TROCADOS ou ALTERADOS de forma relevante.
2. PÁGINAS: o texto do redator indica em qual página vai cada conteúdo (ex.: "Página 2 - ...",
   "Página 10 - ..."). Confira se cada página/peça traz o texto previsto e se o NÚMERO de
   páginas das peças bate com o número de páginas previsto no texto.

Aponte só divergências CLARAS (texto aprovado ausente, texto trocado, página com conteúdo
errado, número de páginas diferente). NÃO aponte estilo, diagramação, cor ou quebras de linha.
Ignore diferenças triviais de maiúsculas/acentuação/espacejamento.
Para cada divergência: 'trecho' = o conteúdo/página em questão; 'problema' = a divergência;
'sugestao' = o que deveria estar. Use tipo 'conteudo' ou 'pagina'.
Se estiver tudo conforme, retorne a lista vazia.`

// ── Seleção de provider ─────────────────────────────────────────────────────

/** Provider da revisão, ou null quando o Gemini não tem chave nenhuma. */
export function configuredProvider(): ReviewProvider | null {
  return geminiConfigured() ? 'gemini' : null
}

/** Há IA de revisão configurada? */
export function reviewConfigured(): boolean {
  return geminiConfigured()
}

// ── Entradas de alto nível ──────────────────────────────────────────────────

const emptyClean = (provider: ReviewProvider): ReviewResult => ({ provider, model: '—', clean: true, errors: [], truncated: false })

/** Revisão ortográfica de um texto puro (Redação). */
export async function reviewText(text: string): Promise<ReviewResult | null> {
  const provider = configuredProvider()
  if (!provider) return null
  const full = (text ?? '').trim()
  const truncated = full.length > MAX_CHARS
  const clipped = truncated ? full.slice(0, MAX_CHARS) : full
  if (!clipped) return emptyClean(provider)

  const { model, list } = await runReview(provider, SYSTEM_TEXT_SPELL, [
    { kind: 'text', text: `Revise o texto abaixo e liste os erros claros de português.\n\n--- INÍCIO DO TEXTO ---\n${clipped}\n--- FIM DO TEXTO ---` },
  ])
  return { provider, model, clean: list.length === 0, errors: list, truncated }
}

/** Revisão ortográfica do texto VISÍVEL em peças (imagens/PDF) — Design/Finalização. */
export async function reviewArtwork(assets: DriveAsset[]): Promise<ReviewResult | null> {
  const provider = configuredProvider()
  if (!provider) return null
  if (!assets.length) return emptyClean(provider)

  const parts: ReviewPart[] = [{ kind: 'text', text: 'Revise a ortografia e a gramática do texto visível nestas peças. Liste apenas erros claros de português.' }]
  for (const a of assets) parts.push({ kind: 'media', mimeType: a.mimeType, base64: a.base64 })

  const { model, list } = await runReview(provider, SYSTEM_ART_SPELL, parts)
  return { provider, model, clean: list.length === 0, errors: list, truncated: false }
}

/** Cruza o texto aprovado da Redação com as peças (texto usado? páginas conferem?). */
export async function crossCheckRedacao(redacaoText: string, assets: DriveAsset[]): Promise<ReviewResult | null> {
  const provider = configuredProvider()
  if (!provider) return null
  const txt = (redacaoText ?? '').trim()
  if (!assets.length || !txt) return emptyClean(provider)

  const truncated = txt.length > MAX_CHARS
  const clipped = truncated ? txt.slice(0, MAX_CHARS) : txt
  const parts: ReviewPart[] = [
    { kind: 'text', text: `TEXTO APROVADO PELO REDATOR (com a indicação de páginas):\n--- INÍCIO ---\n${clipped}\n--- FIM ---\n\nAgora confira as peças anexadas contra esse texto:` },
  ]
  for (const a of assets) parts.push({ kind: 'media', mimeType: a.mimeType, base64: a.base64 })

  const { model, list } = await runReview(provider, SYSTEM_CROSSCHECK, parts)
  return { provider, model, clean: list.length === 0, errors: list, truncated }
}

// ── Execução ────────────────────────────────────────────────────────────────

const ERROS_SCHEMA = {
  type: 'object',
  properties: {
    erros: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          trecho:   { type: 'string' },
          problema: { type: 'string' },
          sugestao: { type: 'string' },
          tipo:     { type: 'string' },
        },
        required: ['trecho', 'problema', 'sugestao'],
      },
    },
  },
  required: ['erros'],
}

async function runReview(_provider: ReviewProvider, system: string, parts: ReviewPart[]): Promise<{ model: string; list: ReviewError[] }> {
  const { model, data } = await geminiJson<{ erros?: unknown }>({
    system,
    parts,
    schema: ERROS_SCHEMA,
    model: process.env.REVIEW_MODEL_GEMINI || process.env.REDACAO_REVIEW_MODEL_GEMINI,
    maxOutputTokens: 8192,
  })
  return { model, list: normalizeErrors(data?.erros) }
}

// ── Parsing tolerante ───────────────────────────────────────────────────────

function normalizeErrors(value: unknown): ReviewError[] {
  if (!Array.isArray(value)) return []
  return value
    .map((e): ReviewError => {
      const o = (e ?? {}) as Record<string, unknown>
      return {
        trecho: String(o.trecho ?? o.excerpt ?? '').slice(0, 500),
        problema: String(o.problema ?? o.problem ?? ''),
        sugestao: String(o.sugestao ?? o.correcao ?? o.suggestion ?? ''),
        tipo: o.tipo ? String(o.tipo) : o.type ? String(o.type) : undefined,
      }
    })
    .filter(e => e.trecho || e.problema)
}
