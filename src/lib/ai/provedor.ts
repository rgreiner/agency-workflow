import 'server-only'
import { geminiConfigured, geminiJson, type IAPart } from './gemini'
import { claudeJson } from './claude'
import { lerRevisaoConfig, type RevisaoConfig } from './revisao-config'

/**
 * Ponto ÚNICO de escolha do provedor de IA do Flow (desde 28/09/2026): a chave,
 * o provedor e o modelo que a org cadastrou em Configurações → Revisão IA valem
 * para tudo — revisão, briefing, extração de folha e de guia. Sem chave
 * cadastrada, cai no Gemini do ambiente (GEMINI_API_KEY), como era antes.
 *
 * O liga/desliga daquela tela é só do botão Revisar; a chave vale sempre.
 */

/** Config de IA da org, ou null se não há org/banco (a chamada usa o ambiente). */
export async function iaDaOrg(orgId: string | null | undefined): Promise<RevisaoConfig | null> {
  if (!orgId) return null
  try {
    return await lerRevisaoConfig(orgId)
  } catch (e) {
    console.error('[ia] config da org ilegível; usando o ambiente', e)
    return null
  }
}

/** Há alguma IA utilizável para esta org (chave cadastrada ou Gemini do ambiente)? */
export function iaDisponivel(cfg: RevisaoConfig | null): boolean {
  if (cfg?.apiKey) return true
  return geminiConfigured()
}

/**
 * Uma chamada, saída JSON estruturada, no provedor da org. `modeloAmbiente` é o
 * override por uso do Gemini do ambiente (ex.: FOLHA_MODEL_GEMINI), usado só
 * quando a org não cadastrou chave.
 */
export async function iaJson<T>(cfg: RevisaoConfig | null, opts: {
  system: string
  parts: IAPart[]
  schema: Record<string, unknown>
  maxOutputTokens?: number
  timeoutMs?: number
  modeloAmbiente?: string | null
}): Promise<{ provider: 'anthropic' | 'gemini'; model: string; data: T | null }> {
  if (cfg?.apiKey && cfg.provider === 'anthropic') {
    const r = await claudeJson<T>({
      apiKey: cfg.apiKey, model: cfg.model, system: opts.system, parts: opts.parts,
      schema: paraClaude(opts.schema),
      // Sem cadeia de reserva no Claude: prazo mínimo de 60 s.
      timeoutMs: Math.max(opts.timeoutMs ?? 150_000, 60_000),
    })
    return { provider: 'anthropic', ...r }
  }
  const chave = cfg?.apiKey && cfg.provider === 'gemini' ? cfg.apiKey : null
  const r = await geminiJson<T>({
    system: opts.system, parts: opts.parts,
    schema: paraGemini(opts.schema),
    model: chave ? cfg!.model : opts.modeloAmbiente,
    apiKey: chave,
    maxOutputTokens: opts.maxOutputTokens,
    timeoutMs: opts.timeoutMs,
  })
  return { provider: 'gemini', ...r }
}

// ── Schema: cada provedor aceita um dialeto ─────────────────────────────────

type Schema = Record<string, unknown>

/**
 * Gemini (responseSchema) é um subconjunto do OpenAPI e RECUSA a requisição
 * inteira com campo que não conhece — `additionalProperties` derrubou o botão
 * Testar em 28/09/2026 com 400, que a tela mostrou como "chave recusada".
 */
function paraGemini(s: Schema): Schema {
  const out: Schema = {}
  for (const [k, v] of Object.entries(s)) {
    if (k === 'additionalProperties') continue
    out[k] = mapear(v, paraGemini)
  }
  return out
}

/** Claude (structured outputs) exige `additionalProperties: false` em todo objeto. */
function paraClaude(s: Schema): Schema {
  const out: Schema = {}
  for (const [k, v] of Object.entries(s)) out[k] = mapear(v, paraClaude)
  if (out.type === 'object') out.additionalProperties = false
  return out
}

function mapear(v: unknown, f: (s: Schema) => Schema): unknown {
  if (Array.isArray(v)) return v.map(x => mapear(x, f))
  // `properties` (mapa nome → schema) passa pelo mesmo f: cada valor é um schema.
  if (v && typeof v === 'object') return f(v as Schema)
  return v
}
