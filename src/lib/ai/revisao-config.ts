import 'server-only'
import { cifrar, decifrar } from './segredo'
import { DEFAULT_ETAPAS, modeloValido, type RevisaoEtapas, type RevisaoProvider } from './revisao-modelos'

/**
 * Config de IA por org (tabela org_ai_config, mig. 304/305): principal + reserva.
 * Lida e escrita
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
  /** Chave reserva (mig. 305), sem o segredo; null = não cadastrada. */
  reserva: { provider: RevisaoProvider; model: string; keyHint: string | null; keyIlegivel: boolean } | null
}

export interface RevisaoConfig extends Omit<RevisaoConfigPublica, 'reserva'> {
  apiKey: string | null
  /** Tentada quando a principal falha (lib/ai/provedor.ts). */
  reserva: { provider: RevisaoProvider; model: string; keyHint: string | null; keyIlegivel: boolean; apiKey: string | null } | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function montar(r: any | undefined): RevisaoConfig {
  const provider: RevisaoProvider = r?.provider === 'gemini' ? 'gemini' : 'anthropic'
  const apiKey = decifrar(r?.api_key_enc)
  const bProvider: RevisaoProvider = r?.backup_provider === 'gemini' ? 'gemini' : 'anthropic'
  const bKey = decifrar(r?.backup_api_key_enc)
  const reserva = r?.backup_api_key_enc
    ? { provider: bProvider, model: modeloValido(bProvider, r?.backup_model), keyHint: r?.backup_key_hint ?? null, keyIlegivel: !bKey, apiKey: bKey }
    : null
  return {
    enabled: !!r?.enabled,
    stages: { ...DEFAULT_ETAPAS, ...(r?.stages ?? {}) },
    provider,
    model: modeloValido(provider, r?.model),
    keyHint: r?.key_hint ?? null,
    keyIlegivel: !!r?.api_key_enc && !apiKey,
    apiKey,
    reserva,
  }
}

export async function lerRevisaoConfig(orgId: string): Promise<RevisaoConfig> {
  const sql = await db()
  const rows = await sql`select * from org_ai_config where org_id = ${orgId} limit 1`
  return montar(rows[0])
}

export async function lerRevisaoConfigPublica(orgId: string): Promise<RevisaoConfigPublica> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { apiKey, reserva, ...pub } = await lerRevisaoConfig(orgId)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { apiKey: _k, ...reservaPub } = reserva ?? { apiKey: null }
  return { ...pub, reserva: reserva ? (reservaPub as RevisaoConfigPublica['reserva']) : null }
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

/** Grava a chave reserva. `apiKey` undefined mantém; '' remove a reserva inteira. */
export async function salvarReservaConfig(orgId: string, userId: string, dados: {
  provider: RevisaoProvider
  model: string
  apiKey?: string
}): Promise<void> {
  const sql = await db()
  const model = modeloValido(dados.provider, dados.model)
  if (dados.apiKey === '') {
    await sql`update org_ai_config set backup_provider = null, backup_model = null, backup_api_key_enc = null,
      backup_key_hint = null, updated_at = now(), updated_by = ${userId} where org_id = ${orgId}`
    return
  }
  const chave = dados.apiKey?.trim()
  const enc = chave ? cifrar(chave) : null
  const hint = chave ? chave.slice(-4) : null
  // A linha já existe quando há reserva (a tela exige a principal salva antes);
  // insert cobre o caso de ser a primeira gravação.
  await sql`
    insert into org_ai_config (org_id, backup_provider, backup_model, backup_api_key_enc, backup_key_hint, updated_at, updated_by)
    values (${orgId}, ${dados.provider}, ${model}, ${enc}, ${hint}, now(), ${userId})
    on conflict (org_id) do update set
      backup_provider = excluded.backup_provider, backup_model = excluded.backup_model,
      backup_api_key_enc = coalesce(${enc}, org_ai_config.backup_api_key_enc),
      backup_key_hint = coalesce(${hint}, org_ai_config.backup_key_hint),
      updated_at = now(), updated_by = excluded.updated_by`
}
