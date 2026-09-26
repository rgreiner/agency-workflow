import 'server-only'
import { cifrar, decifrar } from './segredo'
import { DEFAULT_ETAPAS, modeloValido, type RevisaoEtapas, type RevisaoProvider } from './revisao-modelos'

/**
 * Config da Revisão IA por org (tabela org_ai_config, mig. 304). Lida e escrita
 * SÓ pela conexão direta (lib/db) — a chave nunca passa pelo PostgREST nem chega
 * ao navegador. Quem chama já conferiu a permissão da pessoa.
 */
async function db() {
  // Import dinâmico: lib/db lança sem DATABASE_URL, e o build do Coolify não tem.
  return (await import('@/lib/db')).sql
}

/** O que a tela e a tarefa podem ver — sem a chave. */
export interface RevisaoConfigPublica {
  enabled: boolean
  stages: RevisaoEtapas
  provider: RevisaoProvider
  model: string
  /** Últimos 4 caracteres da chave cadastrada, ou null. */
  keyHint: string | null
  /** Há chave cadastrada mas ela não abre (segredo do servidor mudou). */
  keyIlegivel: boolean
}

export interface RevisaoConfig extends RevisaoConfigPublica {
  apiKey: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function montar(r: any | undefined): RevisaoConfig {
  const provider: RevisaoProvider = r?.provider === 'gemini' ? 'gemini' : 'anthropic'
  const apiKey = decifrar(r?.api_key_enc)
  return {
    enabled: !!r?.enabled,
    stages: { ...DEFAULT_ETAPAS, ...(r?.stages ?? {}) },
    provider,
    model: modeloValido(provider, r?.model),
    keyHint: r?.key_hint ?? null,
    keyIlegivel: !!r?.api_key_enc && !apiKey,
    apiKey,
  }
}

export async function lerRevisaoConfig(orgId: string): Promise<RevisaoConfig> {
  const sql = await db()
  const rows = await sql`select * from org_ai_config where org_id = ${orgId} limit 1`
  return montar(rows[0])
}

export async function lerRevisaoConfigPublica(orgId: string): Promise<RevisaoConfigPublica> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { apiKey, ...pub } = await lerRevisaoConfig(orgId)
  return pub
}

export async function salvarRevisaoConfig(orgId: string, userId: string, dados: {
  enabled: boolean
  stages: RevisaoEtapas
  provider: RevisaoProvider
  model: string
  /** undefined = mantém a chave atual; '' = remove; texto = nova chave. */
  apiKey?: string
}): Promise<void> {
  const sql = await db()
  const model = modeloValido(dados.provider, dados.model)
  const stages = sql.json({ ...DEFAULT_ETAPAS, ...dados.stages })

  if (dados.apiKey === undefined) {
    await sql`
      insert into org_ai_config (org_id, enabled, stages, provider, model, updated_at, updated_by)
      values (${orgId}, ${dados.enabled}, ${stages}, ${dados.provider}, ${model}, now(), ${userId})
      on conflict (org_id) do update set
        enabled = excluded.enabled, stages = excluded.stages, provider = excluded.provider,
        model = excluded.model, updated_at = now(), updated_by = excluded.updated_by`
    return
  }

  const chave = dados.apiKey.trim()
  const enc = chave ? cifrar(chave) : null
  const hint = chave ? chave.slice(-4) : null
  await sql`
    insert into org_ai_config (org_id, enabled, stages, provider, model, api_key_enc, key_hint, updated_at, updated_by)
    values (${orgId}, ${dados.enabled}, ${stages}, ${dados.provider}, ${model}, ${enc}, ${hint}, now(), ${userId})
    on conflict (org_id) do update set
      enabled = excluded.enabled, stages = excluded.stages, provider = excluded.provider,
      model = excluded.model, api_key_enc = excluded.api_key_enc, key_hint = excluded.key_hint,
      updated_at = now(), updated_by = excluded.updated_by`
}
