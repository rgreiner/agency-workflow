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
 * Redundância (28/09/2026): chave RESERVA opcional, tentada quando a principal falha.
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

/** Há alguma IA utilizável para esta org (chave, reserva ou Gemini do ambiente)? */
export function iaDisponivel(cfg: RevisaoConfig | null): boolean {
  if (cfg?.apiKey || cfg?.reserva?.apiKey) return true
  return geminiConfigured()
}

type Destino = { provider: 'anthropic' | 'gemini'; model: string | null | undefined; apiKey: string | null }

interface IaOpts {
  system: string
  parts: IAPart[]
  schema: Record<string, unknown>
  maxOutputTokens?: number
  timeoutMs?: number
  modeloAmbiente?: string | null
}

/**
 * Uma chamada, saída JSON estruturada, no provedor da org. Falhou a principal
 * (qualquer motivo: crédito, chave, provedor fora do ar), tenta a RESERVA
 * cadastrada; sem reserva, o erro da principal sobe. `modeloAmbiente` é o
 * override por uso do Gemini do ambiente (ex.: FOLHA_MODEL_GEMINI), usado só
 * quando a org não cadastrou chave principal.
 */
export async function iaJson<T>(cfg: RevisaoConfig | null, opts: IaOpts): Promise<{ provider: 'anthropic' | 'gemini'; model: string; data: T | null }> {
  const principal: Destino | null = cfg?.apiKey
    ? { provider: cfg.provider, model: cfg.model, apiKey: cfg.apiKey }
    : geminiConfigured() ? { provider: 'gemini', model: opts.modeloAmbiente, apiKey: null } : null
  const reserva: Destino | null = cfg?.reserva?.apiKey
    ? { provider: cfg.reserva.provider, model: cfg.reserva.model, apiKey: cfg.reserva.apiKey }
    : null

  if (!principal && !reserva) throw new Error('SEM_CHAVE')
  if (!principal) return chamar<T>(reserva!, opts)
  try {
    return await chamar<T>(principal, opts)
  } catch (e) {
    if (!reserva) throw e
    console.warn(`[ia] principal (${principal.provider}) falhou; tentando a reserva (${reserva.provider}):`, e instanceof Error ? e.message.slice(0, 200) : e)
    return chamar<T>(reserva, opts)
  }
}

async function chamar<T>(d: Destino, opts: IaOpts): Promise<{ provider: 'anthropic' | 'gemini'; model: string; data: T | null }> {
  if (d.provider === 'anthropic') {
    const r = await claudeJson<T>({
      apiKey: d.apiKey!, model: d.model!, system: opts.system, parts: opts.parts,
      schema: paraClaude(opts.schema),
      // Sem cadeia de reserva no Claude: prazo mínimo de 60 s.
      timeoutMs: Math.max(opts.timeoutMs ?? 150_000, 60_000),
    })
    return { provider: 'anthropic', ...r }
  }
  const r = await geminiJson<T>({
    system: opts.system, parts: opts.parts,
    schema: paraGemini(opts.schema),
    model: d.model, apiKey: d.apiKey,
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
