import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { ErroIA, parseJson, type IAPart } from './gemini'

/**
 * Chamada ao Claude com saída estruturada (JSON schema), multimodal: texto,
 * imagens e PDF. Hoje só a Revisão IA usa, com a chave cadastrada pela org em
 * Configurações → Revisão IA (não há ANTHROPIC_API_KEY no ambiente).
 */
export async function claudeJson<T>(opts: {
  apiKey: string
  model: string
  system: string
  parts: IAPart[]
  schema: Record<string, unknown>
  timeoutMs?: number
}): Promise<{ model: string; data: T | null }> {
  const client = new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs ?? 150_000, maxRetries: 2 })

  const content: Anthropic.Beta.BetaContentBlockParam[] = []
  for (const p of opts.parts) {
    if (p.kind === 'text') { content.push({ type: 'text', text: p.text }); continue }
    if (p.mimeType === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.base64 } })
      continue
    }
    const mt = p.mimeType.toLowerCase().replace('image/jpg', 'image/jpeg')
    if (mt === 'image/png' || mt === 'image/jpeg' || mt === 'image/webp' || mt === 'image/gif') {
      content.push({ type: 'image', source: { type: 'base64', media_type: mt, data: p.base64 } })
    }
  }

  // Opus 5 pode recusar por classificador de segurança; `fallbacks: 'default'`
  // refaz no modelo que a Anthropic recomenda em vez de devolver a recusa.
  const comFallback = opts.model === 'claude-opus-5'
  // Haiku 4.5 não tem pensamento adaptativo; os demais pensam por padrão —
  // esforço médio basta pra revisão de texto.
  const pensa = !opts.model.startsWith('claude-haiku')

  let res: Anthropic.Beta.BetaMessage
  try {
    res = await client.beta.messages.create({
      model: opts.model,
      max_tokens: 16000,
      system: opts.system,
      messages: [{ role: 'user', content }],
      output_config: { format: { type: 'json_schema', schema: opts.schema }, ...(pensa ? { effort: 'medium' as const } : {}) },
      ...(comFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    })
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      const err = new ErroIA(e.status ?? 0, `Claude ${e.status ?? ''}: ${e.message}`.slice(0, 500))
      err.transitorio = e.status === 429 || e.status === 529 || (e.status ?? 0) >= 500
      throw err
    }
    throw e
  }

  if (res.stop_reason === 'refusal') throw new ErroIA(0, 'Claude recusou o pedido (refusal).')
  if (res.stop_reason === 'max_tokens') throw new ErroIA(0, 'Claude: a resposta estourou o limite de tokens.')
  const raw = res.content.map(b => (b.type === 'text' ? b.text : '')).join('')
  return { model: res.model, data: parseJson<T>(raw) }
}
