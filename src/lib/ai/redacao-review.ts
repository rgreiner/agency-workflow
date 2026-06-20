import 'server-only'

/**
 * Revisão de português (pt-BR) de textos de Redação, agnóstica de provider.
 *
 * O provider é escolhido pelas chaves presentes no ambiente — "a chave que tiver,
 * o sistema usa":
 *   - Gemini:  GEMINI_API_KEY (AI Studio)  OU  GOOGLE_VERTEX_PROJECT + GOOGLE_SERVICE_ACCOUNT_KEY (Vertex AI).
 *   - Claude:  ANTHROPIC_API_KEY.
 *   - Forçar:  REDACAO_REVIEW_PROVIDER = 'gemini' | 'claude' (default 'auto').
 *
 * Não adiciona dependência: Claude usa o @anthropic-ai/sdk já instalado e Gemini
 * é chamado por REST (Vertex reusa a JWT da conta de serviço do Drive).
 */

export type ReviewProvider = 'gemini' | 'claude'

export interface ReviewError {
  /** Trecho exato onde está o erro. */
  trecho: string
  /** O que está errado. */
  problema: string
  /** Correção sugerida. */
  sugestao: string
  /** ortografia | gramatica | concordancia | regencia | pontuacao | outro */
  tipo?: string
}

export interface ReviewResult {
  provider: ReviewProvider
  model: string
  clean: boolean
  errors: ReviewError[]
  /** Texto foi truncado por exceder o limite enviado ao modelo. */
  truncated: boolean
}

// Limite de caracteres enviados ao modelo (controla custo/latência). ~6-8 páginas.
const MAX_CHARS = 20000

const SYSTEM_PROMPT = `Você é um revisor de português (pt-BR) de peças publicitárias.

Sua tarefa é apontar APENAS erros CLAROS e objetivos de língua:
- ortografia / acentuação
- gramática (regência, crase, colocação)
- concordância (verbal e nominal)
- pontuação que cause erro real

REGRAS IMPORTANTES (evitam falso positivo):
- NÃO sugira reescritas de estilo, NÃO mude o tom nem a voz do texto.
- NÃO marque gírias, informalidades, neologismos publicitários, nomes de marca,
  hashtags, CTAs ou escolhas estilísticas como erro — podem ser intencionais.
- Na dúvida entre "erro" e "escolha do redator", NÃO reporte.
- Quem decide o que é proposital é o redator; você só lista o que é erro evidente.

Para cada erro, informe: o trecho exato, o problema e a correção.
Se não houver nenhum erro claro, retorne a lista vazia.`

function buildUserPrompt(text: string): string {
  return `Revise o texto abaixo e liste os erros claros de português.\n\n--- INÍCIO DO TEXTO ---\n${text}\n--- FIM DO TEXTO ---`
}

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
  const forced = (process.env.REDACAO_REVIEW_PROVIDER || 'auto').toLowerCase()
  if (forced === 'gemini') return geminiConfigured() ? 'gemini' : null
  if (forced === 'claude') return claudeConfigured() ? 'claude' : null
  // auto: usa a que tiver chave (Gemini primeiro, por consolidar no Google).
  if (geminiConfigured()) return 'gemini'
  if (claudeConfigured()) return 'claude'
  return null
}

/** Há algum provider de revisão configurado? */
export function reviewConfigured(): boolean {
  return configuredProvider() !== null
}

// ── Entrada principal ───────────────────────────────────────────────────────

/**
 * Revisa o texto e devolve os erros. Retorna `null` se nenhum provider estiver
 * configurado (o chamador trata como "revisão indisponível"). Texto vazio = limpo.
 */
export async function reviewRedacaoText(text: string): Promise<ReviewResult | null> {
  const provider = configuredProvider()
  if (!provider) return null

  const full = (text ?? '').trim()
  const truncated = full.length > MAX_CHARS
  const clipped = truncated ? full.slice(0, MAX_CHARS) : full

  if (!clipped) {
    return { provider, model: '—', clean: true, errors: [], truncated: false }
  }

  const errors = provider === 'gemini'
    ? await reviewWithGemini(clipped)
    : await reviewWithClaude(clipped)

  return {
    provider,
    model: errors.model,
    clean: errors.list.length === 0,
    errors: errors.list,
    truncated,
  }
}

// ── Provider: Claude (@anthropic-ai/sdk, já instalado) ──────────────────────

const ERROS_TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    erros: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          trecho: { type: 'string' as const },
          problema: { type: 'string' as const },
          sugestao: { type: 'string' as const },
          tipo: { type: 'string' as const },
        },
        required: ['trecho', 'problema', 'sugestao'],
      },
    },
  },
  required: ['erros'],
}

async function reviewWithClaude(text: string): Promise<{ model: string; list: ReviewError[] }> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const model = process.env.REDACAO_REVIEW_MODEL_CLAUDE || 'claude-haiku-4-5-20251001'

  const msg = await client.messages.create({
    model,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    tools: [{ name: 'reportar_erros', description: 'Reporta os erros de português encontrados.', input_schema: ERROS_TOOL_SCHEMA }],
    tool_choice: { type: 'tool', name: 'reportar_erros' },
    messages: [{ role: 'user', content: buildUserPrompt(text) }],
  })

  const block = msg.content.find(b => b.type === 'tool_use')
  const input = (block && 'input' in block ? block.input : null) as { erros?: unknown } | null
  return { model, list: normalizeErrors(input?.erros) }
}

// ── Provider: Gemini (REST — Vertex AI ou AI Studio) ────────────────────────

const GEMINI_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    erros: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          trecho: { type: 'string' },
          problema: { type: 'string' },
          sugestao: { type: 'string' },
          tipo: { type: 'string' },
        },
        required: ['trecho', 'problema', 'sugestao'],
      },
    },
  },
  required: ['erros'],
}

async function reviewWithGemini(text: string): Promise<{ model: string; list: ReviewError[] }> {
  const model = process.env.REDACAO_REVIEW_MODEL_GEMINI || 'gemini-2.5-flash'
  const { url, headers } = await geminiEndpoint(model)

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: buildUserPrompt(text) }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: GEMINI_RESPONSE_SCHEMA,
    },
  }

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${await res.text().catch(() => res.statusText)}`)
  }
  const data = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
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
  // Vertex AI — reusa a conta de serviço do Drive.
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
