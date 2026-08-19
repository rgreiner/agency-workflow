import 'server-only'

/**
 * ÚNICO ponto de contato do Flow com a IA. Decisão de 11/08/2026: um provedor só
 * (Gemini). Antes havia dois caminhos vivos — Claude no `review`/`briefing` e
 * Claude EXCLUSIVO na extração de folha e de guia —, e o resultado era o pior dos
 * dois mundos: em produção não existe ANTHROPIC_API_KEY, então a extração de folha
 * e de guia respondia 503 "IA não configurada" desde sempre, enquanto a revisão
 * caía no Gemini por acaso, não por escolha.
 *
 * Dois backends, mesma chamada:
 *   • AI Studio — GEMINI_API_KEY (ou GOOGLE_GENAI_API_KEY). Créditos pré-pagos.
 *   • Vertex    — GOOGLE_VERTEX_PROJECT + GOOGLE_SERVICE_ACCOUNT_KEY. Billing do
 *                 projeto no Google Cloud.
 * GEMINI_BACKEND=studio|vertex força um deles; sem ela, usa a chave do AI Studio
 * quando existir e cai no Vertex quando não.
 *
 * Modelo: GEMINI_MODEL para todo mundo, com override por uso
 * (REVIEW_MODEL_GEMINI, BRIEFING_MODEL_GEMINI, FOLHA_MODEL_GEMINI, GUIA_MODEL_GEMINI).
 */

/** Parte de entrada — texto ou mídia (imagem/PDF) em base64. */
export type IAPart =
  | { kind: 'text'; text: string }
  | { kind: 'media'; mimeType: string; base64: string }

/** Erro de IA com o status HTTP preservado (lib/ai/erro.ts traduz pela pessoa). */
export class ErroIA extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ErroIA'
    this.status = status
  }
}

const DEFAULT_MODEL = 'gemini-3.6-flash'

/** Modelo do uso pedido, com fallback pro geral e pro default da casa. */
export function geminiModel(override?: string | null): string {
  return override || process.env.GEMINI_MODEL || DEFAULT_MODEL
}

export function geminiConfigured(): boolean {
  return !!(
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY ||
    (process.env.GOOGLE_VERTEX_PROJECT && process.env.GOOGLE_SERVICE_ACCOUNT_KEY)
  )
}

/** URL + headers do backend em uso. */
export async function geminiEndpoint(model: string): Promise<{ url: string; headers: Record<string, string> }> {
  const backend = (process.env.GEMINI_BACKEND || 'auto').toLowerCase()
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY

  if (backend !== 'vertex' && apiKey) {
    return {
      // A chave vai no header, não na query: URL com segredo vaza em log de proxy.
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    }
  }

  const project = process.env.GOOGLE_VERTEX_PROJECT
  if (!project) {
    throw new ErroIA(503, backend === 'vertex'
      ? 'GEMINI_BACKEND=vertex exige GOOGLE_VERTEX_PROJECT.'
      : 'Gemini não configurado (falta GEMINI_API_KEY ou GOOGLE_VERTEX_PROJECT).')
  }
  const location = process.env.GOOGLE_VERTEX_LOCATION || 'us-central1'
  const token = await vertexAccessToken()
  return {
    url: `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  }
}

async function vertexAccessToken(): Promise<string> {
  const { google } = await import('googleapis')
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!raw) throw new ErroIA(503, 'Vertex AI requer GOOGLE_SERVICE_ACCOUNT_KEY.')
  const creds = parseServiceAccount(raw)
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  })
  const { access_token } = await auth.authorize()
  if (!access_token) throw new ErroIA(503, 'Falha ao obter token de acesso do Vertex AI.')
  return access_token
}

function parseServiceAccount(raw: string): { client_email: string; private_key: string } {
  const txt = raw.trim()
  try { return JSON.parse(txt) } catch { /* tenta base64 */ }
  try { return JSON.parse(Buffer.from(txt, 'base64').toString('utf8')) } catch { /* inválida */ }
  throw new ErroIA(503, 'GOOGLE_SERVICE_ACCOUNT_KEY inválida (esperado JSON ou base64).')
}

export interface GeminiJsonOpts {
  system: string
  parts: IAPart[]
  /** JSON Schema da resposta (subset do Gemini: type/properties/items/required/enum/description). */
  schema: unknown
  model?: string | null
  maxOutputTokens?: number
  temperature?: number
}

/**
 * Uma chamada, saída estruturada. Devolve o objeto já parseado (ou null quando o
 * modelo não produziu JSON válido) junto do modelo que respondeu.
 *
 * ⚠️ Os modelos em uso são de RACIOCÍNIO (`"thinking": true` na descrição do
 * modelo — conferido na API): o pensamento gasta o MESMO orçamento de
 * `maxOutputTokens` que a resposta. Orçamento apertado não devolve resposta
 * curta: devolve resposta VAZIA com `finishReason: MAX_TOKENS`, que o parse leria
 * como "o modelo não achou nada" — silencioso e errado. Por isso o default aqui é
 * folgado (o teto dos modelos é 65.536) e o corte por token vira erro explícito.
 */
export async function geminiJson<T>(opts: GeminiJsonOpts): Promise<{ model: string; data: T | null }> {
  const pedido = geminiModel(opts.model)

  const body = {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{
      role: 'user',
      parts: opts.parts.map(p => p.kind === 'text'
        ? { text: p.text }
        : { inlineData: { mimeType: p.mimeType, data: p.base64 } }),
    }],
    generationConfig: {
      temperature: opts.temperature ?? 0,
      maxOutputTokens: opts.maxOutputTokens ?? 16384,
      responseMimeType: 'application/json',
      responseSchema: opts.schema,
    },
  }

  const { model, res } = await postNoModelo(pedido, JSON.stringify(body))
  const json = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
    promptFeedback?: { blockReason?: string }
  }
  const cand = json.candidates?.[0]
  const raw = cand?.content?.parts?.map(p => p.text ?? '').join('') ?? ''
  const data = parseJson<T>(raw)

  if (!data) {
    const motivo = cand?.finishReason ?? json.promptFeedback?.blockReason
    if (motivo === 'MAX_TOKENS') {
      throw new ErroIA(0, 'Gemini: a resposta estourou o limite de tokens antes de terminar o JSON. Aumente maxOutputTokens ou reduza o documento.')
    }
    if (motivo && motivo !== 'STOP') {
      throw new ErroIA(0, `Gemini interrompeu a resposta (${motivo}).`)
    }
  }
  return { model, data }
}

/**
 * O Google APOSENTA modelo: `gemini-2.5-flash` virou 404 em 19/08/2026 com o recado
 * "no longer available to new users. Please update your code to use
 * models/gemini-3.6-flash". Quem morre nisso não é o código (o default da casa já é
 * o modelo novo) e sim uma env var velha no Coolify — e o efeito é a revisão inteira
 * parar até alguém mexer no painel. Então: 404 de modelo NÃO é fim de linha. Tenta de
 * novo com o substituto que o próprio Google indica na mensagem (ou com o default da
 * casa) e segue o trabalho, deixando o aviso no log pra env ser corrigida.
 */
async function postNoModelo(pedido: string, body: string): Promise<{ model: string; res: Response }> {
  const { url, headers } = await geminiEndpoint(pedido)
  try {
    return { model: pedido, res: await postComRetry(url, headers, body) }
  } catch (e) {
    if (!(e instanceof ErroIA) || e.status !== 404) throw e
    const substituto = modeloSubstituto(e.message, pedido)
    if (!substituto) throw e
    console.warn(`[gemini] modelo "${pedido}" não existe mais; usando "${substituto}". Corrija GEMINI_MODEL/REVIEW_MODEL_GEMINI no Coolify.`)
    const alt = await geminiEndpoint(substituto)
    return { model: substituto, res: await postComRetry(alt.url, alt.headers, body) }
  }
}

/** Modelo sugerido pelo próprio 404 ("use models/X"), senão o default da casa. */
function modeloSubstituto(mensagem: string, pedido: string): string | null {
  const sugerido = mensagem.match(/use\s+models\/([A-Za-z0-9.\-_]+)/)?.[1]
  const alvo = sugerido || DEFAULT_MODEL
  return alvo === pedido ? null : alvo
}

/**
 * 429/500/503 do Gemini costumam ser passageiros e o retry resolve de graça — MENOS
 * quando o 429 é falta de crédito/cota, que não melhora esperando: aí levanta na hora
 * pra pessoa ver o recado certo em vez de encarar 3 tentativas de espera.
 */
async function postComRetry(url: string, headers: Record<string, string>, body: string): Promise<Response> {
  const TENTATIVAS = 3
  let ultimo: ErroIA | null = null

  for (let i = 0; i < TENTATIVAS; i++) {
    let res: Response
    try {
      res = await fetch(url, { method: 'POST', headers, body })
    } catch (e) {
      ultimo = new ErroIA(0, `Falha de rede ao falar com o Gemini: ${e instanceof Error ? e.message : String(e)}`)
      if (i === TENTATIVAS - 1) throw ultimo
      await espera(i)
      continue
    }
    if (res.ok) return res

    const texto = await res.text().catch(() => res.statusText)
    const erro = new ErroIA(res.status, `Gemini ${res.status}: ${texto.slice(0, 400)}`)
    const semSaldo = /credit|billing|quota|exceeded/i.test(texto)
    const vaiMelhorar = (res.status === 429 && !semSaldo) || res.status === 500 || res.status === 503
    if (!vaiMelhorar || i === TENTATIVAS - 1) throw erro
    ultimo = erro
    await espera(i)
  }
  throw ultimo ?? new ErroIA(0, 'Gemini: falha desconhecida.')
}

const espera = (tentativa: number) => new Promise(r => setTimeout(r, 800 * 2 ** tentativa))

/** Parsing tolerante: o modelo às vezes embrulha o JSON em ```json. */
export function parseJson<T>(raw: string): T | null {
  if (!raw) return null
  const limpo = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try { return JSON.parse(limpo) as T } catch { /* tenta achar o objeto no meio */ }
  const m = limpo.match(/[[{][\s\S]*[\]}]/)
  if (!m) return null
  try { return JSON.parse(m[0]) as T } catch { return null }
}
