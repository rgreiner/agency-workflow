/**
 * Acesso do cliente ao portal (magic link, sem senha). Molde do reset.ts:
 * token cru só no e-mail, guardado hasheado (sha256), uso único, e a camada de
 * auth fala com o banco pela conexão direta (lib/db). A sessão vira o cookie
 * `flow-portal-jwt` (httpOnly — o portal é 100% server-rendered, o browser não
 * precisa ler o token).
 */
import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { sql } from '@/lib/db'
import {
  COOKIE_PORTAL, PORTAL_MAX_AGE_SEG, mintPortalToken, verifyPortalToken,
} from './jwt'

const TTL_MIN = 30 // validade do link de acesso

export interface PortalUser {
  id: string
  org_id: string
  workspace_id: string
  nome: string
  email: string
  ativo: boolean
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/** Contato ATIVO do portal por e-mail (case-insensitive), ou null. */
export async function buscarPortalUserPorEmail(email: string): Promise<PortalUser | null> {
  const rows = await sql<PortalUser[]>`
    select id, org_id, workspace_id, nome, email, ativo
    from public.portal_users
    where lower(email) = lower(${email.trim()}) and ativo
    limit 1
  `
  return rows[0] ?? null
}

/** Cria um token de acesso e devolve o token CRU (vai só no e-mail). */
export async function criarTokenPortal(portalUserId: string): Promise<string> {
  const raw = randomBytes(32).toString('hex')
  await sql`
    insert into auth.portal_login_tokens (portal_user_id, token_hash, expires_at)
    values (${portalUserId}, ${hashToken(raw)}, now() + ${TTL_MIN} * interval '1 minute')
  `
  return raw
}

/** Token ainda é válido (não usado, não expirado)? Não consome. */
export async function tokenPortalValido(raw: string): Promise<boolean> {
  const rows = await sql<{ ok: boolean }[]>`
    select true as ok from auth.portal_login_tokens
    where token_hash = ${hashToken(raw)} and used_at is null and expires_at > now()
    limit 1
  `
  return rows.length > 0
}

/**
 * Consome o token (uso único, atômico) e devolve o contato do portal, ou null.
 * Também carimba o last_login_at.
 */
export async function consumirTokenPortal(raw: string): Promise<PortalUser | null> {
  const rows = await sql<{ portal_user_id: string }[]>`
    update auth.portal_login_tokens
       set used_at = now()
     where token_hash = ${hashToken(raw)} and used_at is null and expires_at > now()
     returning portal_user_id
  `
  const id = rows[0]?.portal_user_id
  if (!id) return null

  const users = await sql<PortalUser[]>`
    update public.portal_users set last_login_at = now()
    where id = ${id} and ativo
    returning id, org_id, workspace_id, nome, email, ativo
  `
  return users[0] ?? null
}

/** Abre a sessão do portal (seta o cookie). */
export async function iniciarSessaoPortal(user: PortalUser): Promise<void> {
  const jar = await cookies()
  jar.set(COOKIE_PORTAL, await mintPortalToken({ portalSub: user.id, email: user.email }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/portal',
    maxAge: PORTAL_MAX_AGE_SEG,
  })
}

/** Encerra a sessão do portal. */
export async function encerrarSessaoPortal(): Promise<void> {
  const jar = await cookies()
  jar.delete({ name: COOKIE_PORTAL, path: '/portal' })
}

/** Claims da sessão do portal atual, ou null (deslogado/expirado). */
export async function sessaoPortal() {
  const jar = await cookies()
  return verifyPortalToken(jar.get(COOKIE_PORTAL)?.value)
}

/** Token assinado da sessão atual (pro supabase-js falar com o PostgREST), ou null. */
export async function tokenSessaoPortal(): Promise<string | null> {
  const jar = await cookies()
  const raw = jar.get(COOKIE_PORTAL)?.value
  return (await verifyPortalToken(raw)) ? raw! : null
}
