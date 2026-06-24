import 'server-only'
import type { DriveAsset } from '@/lib/google-drive'

/**
 * Motor de revisão por IA, agnóstico de provider e MULTIMODAL (texto + imagens/PDF).
 *
 * Provider escolhido pelas chaves do ambiente ("a chave que tiver, usa"):
 *   - Gemini:  GEMINI_API_KEY (AI Studio)  OU  GOOGLE_VERTEX_PROJECT + GOOGLE_SERVICE_ACCOUNT_KEY (Vertex).
 *   - Claude:  ANTHROPIC_API_KEY.
 *   - Forçar:  REVIEW_PROVIDER (ou REDACAO_REVIEW_PROVIDER) = 'gemini' | 'claude' (default 'auto').
 *
 * Os modelos default (Gemini 2.5 Flash / Claude Haiku 4.5) já aceitam imagem e PDF.
 */

export type ReviewProvider = 'gemini' | 'claude'

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

/** Parte de entrada multimodal. */
export type ReviewPart =
  | { kind: 'text'; text: string }
  | { kind: 'media'; mimeType: string; base64: string }

// Limite de caracteres de texto enviados ao modelo (controla custo/latência). ~6-8 páginas.
const MAX_CHARS = 20000
const PDF_MIME  = 'application/pdf'

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

function geminiConfigured(): boolean {
  return !!(
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY ||
    (process.env.GOOGLE_VERTEX_PROJECT && process.env.GOOGLE_SERVICE_ACCOUNT_KEY)
  )
}
function claudeConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

/** Provider que será usado com a configuração atual (ou null se nenhum tem chave). */
export function configuredProvider(): ReviewProvider | null {
  const forced = (process.env.REVIEW_PROVIDER || process.env.REDACAO_REVIEW_PROVIDER || 'auto').toLowerCase()
  if (forced === 'gemini') return geminiConfigured() ? 'gemini' : null
  if (forced === 'claude') return claudeConfigured() ? 'claude' : null
  if (geminiConfigured()) return 'gemini'
  if (claudeConfigured()) return 'claude'
  return null
}

/** Há algum provider de revisão configurado? */
export function reviewConfigured(): boolean {
  return configuredProvider() !== null
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

// ── Execução por provider ───────────────────────────────────────────────────

function runReview(provider: ReviewProvider, system: string, parts: ReviewPart[]): Promise<{ model: string; list: ReviewError[] }> {
  return provider === 'claude' ? runClaude(system, parts) : runGemini(system, parts)
}

const ERROS_TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    erros: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          trecho:   { type: 'string' as const },
          problema: { type: 'string' as const },
          sugestao: { type: 'string' as const },
          tipo:     { type: 'string' as const },
        },
        required: ['trecho', 'problema', 'sugestao'],
      },
    },
  },
  required: ['erros'],
}

async function runClaude(system: string, parts: ReviewPart[]): Promise<{ model: string; list: ReviewError[] }> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const model = process.env.REVIEW_MODEL_CLAUDE || process.env.REDACAO_REVIEW_MODEL_CLAUDE || 'claude-haiku-4-5-20251001'

  const content = parts.map(p => {
    if (p.kind === 'text') return { type: 'text', text: p.text }
    if (p.mimeType === PDF_MIME) return { type: 'document', source: { type: 'base64', media_type: PDF_MIME, data: p.base64 } }
    return { type: 'image', source: { type: 'base64', media_type: p.mimeType, data: p.base64 } }
  })

  const msg = await client.messages.create({
    model,
    max_tokens: 4096,
    system,
    tools: [{ name: 'reportar_erros', description: 'Reporta os erros/divergências encontrados.', input_schema: ERROS_TOOL_SCHEMA }],
    tool_choice: { type: 'tool', name: 'reportar_erros' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: [{ role: 'user', content: content as any }],
  })

  const block = msg.content.find(b => b.type === 'tool_use')
  const input = (block && 'input' in block ? block.input : null) as { erros?: unknown } | null
  return { model, list: normalizeErrors(input?.erros) }
}

const GEMINI_RESPONSE_SCHEMA = {
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

async function runGemini(system: string, parts: ReviewPart[]): Promise<{ model: string; list: ReviewError[] }> {
  const model = process.env.REVIEW_MODEL_GEMINI || process.env.REDACAO_REVIEW_MODEL_GEMINI || 'gemini-2.5-flash'
  const { url, headers } = await geminiEndpoint(model)

  const gParts = parts.map(p => p.kind === 'text'
    ? { text: p.text }
    : { inlineData: { mimeType: p.mimeType, data: p.base64 } })

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: gParts }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: GEMINI_RESPONSE_SCHEMA },
  }

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text().catch(() => res.statusText)}`)
  const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const raw = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? ''
  return { model, list: parseErrorsJson(raw) }
}

/** Monta URL + headers do Gemini: AI Studio (key) se houver, senão Vertex (JWT). */
async function geminiEndpoint(model: string): Promise<{ url: string; headers: Record<string, string> }> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY
  if (apiKey) {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      headers: { 'Content-Type': 'application/json' },
    }
  }
  const project = process.env.GOOGLE_VERTEX_PROJECT
  if (!project) throw new Error('Gemini não configurado (falta GEMINI_API_KEY ou GOOGLE_VERTEX_PROJECT).')
  const location = process.env.GOOGLE_VERTEX_LOCATION || 'us-central1'
  const token = await vertexAccessToken()
  const host = `${location}-aiplatform.googleapis.com`
  return {
    url: `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  }
}

async function vertexAccessToken(): Promise<string> {
  const { google } = await import('googleapis')
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!raw) throw new Error('Vertex AI requer GOOGLE_SERVICE_ACCOUNT_KEY.')
  const creds = parseServiceAccount(raw)
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  })
  const { access_token } = await auth.authorize()
  if (!access_token) throw new Error('Falha ao obter token de acesso do Vertex AI.')
  return access_token
}

function parseServiceAccount(raw: string): { client_email: string; private_key: string } {
  const txt = raw.trim()
  try { return JSON.parse(txt) } catch { /* tenta base64 */ }
  try { return JSON.parse(Buffer.from(txt, 'base64').toString('utf8')) } catch { /* inválida */ }
  throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY inválida (esperado JSON ou base64).')
}

// ── Parsing tolerante ───────────────────────────────────────────────────────

function parseErrorsJson(raw: string): ReviewError[] {
  if (!raw) return []
  const json = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    const m = json.match(/[[{][\s\S]*[\]}]/)
    if (!m) return []
    try { parsed = JSON.parse(m[0]) } catch { return [] }
  }
  const arr = Array.isArray(parsed)
    ? parsed
    : (parsed as { erros?: unknown; errors?: unknown })?.erros ?? (parsed as { errors?: unknown })?.errors
  return normalizeErrors(arr)
}

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
