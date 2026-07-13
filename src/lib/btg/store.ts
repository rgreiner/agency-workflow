/**
 * Persistência da conexão BTG por org — via conexão Postgres DIRETA (lib/db), NUNCA
 * pelo PostgREST, pra o refresh token não chegar ao cliente. A tabela tem RLS sem
 * policy (bloqueia PostgREST); a role da conexão direta é dona e bypassa a RLS.
 */
// Import dinâmico: lib/db lança se faltar DATABASE_URL no IMPORT, e o build do
// Coolify não tem esse secret. Carregar sob demanda (runtime) evita quebrar o build.
async function db() {
  return (await import('@/lib/db')).sql
}

export interface BtgConnection {
  orgId: string
  companyId: string | null
  accountId: string | null
  refreshToken: string | null
  scopes: string | null
  status: string
  connectedAt: string | null
  lastSyncAt: string | null
  lastError: string | null
}

// postgres.js devolve colunas timestamptz como objeto Date, não string — normaliza
// pra ISO string aqui (a origem), senão .slice()/formatDateBR() no client quebram.
function toIso(v: unknown): string | null {
  if (v == null) return null
  return v instanceof Date ? v.toISOString() : String(v)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function row(r: any): BtgConnection {
  return {
    orgId: r.org_id, companyId: r.company_id, accountId: r.account_id,
    refreshToken: r.refresh_token, scopes: r.scopes, status: r.status,
    connectedAt: toIso(r.connected_at), lastSyncAt: toIso(r.last_sync_at), lastError: r.last_error,
  }
}

export async function getBtgConnection(orgId: string): Promise<BtgConnection | null> {
  const sql = await db()
  const rows = await sql`select * from btg_connections where org_id = ${orgId} limit 1`
  return rows.length ? row(rows[0]) : null
}

export async function saveBtgConnection(orgId: string, data: {
  companyId: string; refreshToken: string; scopes: string
}): Promise<void> {
  const sql = await db()
  await sql`
    insert into btg_connections (org_id, company_id, refresh_token, scopes, status, connected_at, updated_at)
    values (${orgId}, ${data.companyId}, ${data.refreshToken}, ${data.scopes}, 'connected', now(), now())
    on conflict (org_id) do update set
      company_id = excluded.company_id,
      refresh_token = excluded.refresh_token,
      scopes = excluded.scopes,
      status = 'connected',
      connected_at = now(),
      last_error = null,
      updated_at = now()`
}

/** Guarda o refresh token rotacionado (a cada refresh o BTG devolve um novo). */
export async function updateBtgRefreshToken(orgId: string, refreshToken: string): Promise<void> {
  const sql = await db()
  await sql`update btg_connections set refresh_token = ${refreshToken}, updated_at = now() where org_id = ${orgId}`
}

export async function setBtgAccount(orgId: string, accountId: string): Promise<void> {
  const sql = await db()
  await sql`update btg_connections set account_id = ${accountId}, updated_at = now() where org_id = ${orgId}`
}

export async function markBtgSynced(orgId: string): Promise<void> {
  const sql = await db()
  await sql`update btg_connections set last_sync_at = now(), status = 'connected', last_error = null, updated_at = now() where org_id = ${orgId}`
}

export async function markBtgError(orgId: string, message: string): Promise<void> {
  const sql = await db()
  await sql`update btg_connections set status = 'error', last_error = ${message.slice(0, 500)}, updated_at = now() where org_id = ${orgId}`
}

export async function deleteBtgConnection(orgId: string): Promise<void> {
  const sql = await db()
  await sql`delete from btg_connections where org_id = ${orgId}`
}

/** Orgs com conexão ativa (refresh token presente, não revogada) — usado pelo cron. */
export async function listConnectedOrgIds(): Promise<string[]> {
  const sql = await db()
  const rows = await sql`select org_id from btg_connections where refresh_token is not null and status <> 'revoked'`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((r: any) => r.org_id as string)
}
