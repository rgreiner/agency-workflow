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
import { hashSenha, conferirSenha, normalizarSenha } from './password'
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

/**
 * Contatos ATIVOS com este e-mail. Devolve LISTA de propósito: a mesma pessoa
 * pode ser contato de mais de um cliente (ex.: um grupo com duas marcas). Cada
 * acesso é um portal_user próprio, com seu painel — por isso o login manda um
 * link por cliente, em vez de escolher um deles em silêncio.
 */
export async function buscarPortalUsersPorEmail(email: string): Promise<PortalUser[]> {
  return sql<PortalUser[]>`
    select id, org_id, workspace_id, nome, email, ativo
    from public.portal_users
    where lower(email) = lower(${email.trim()}) and ativo
    order by created_at
  `
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
    // path '/' (não '/portal'): as peças são servidas por /api/portal/*, que NÃO
    // é subpath de /portal — com path '/portal' o cookie não chegava nessas rotas
    // e toda peça voltava 401 "Sessão expirada" (imagem/vídeo/PDF/baixar).
    path: '/',
    maxAge: PORTAL_MAX_AGE_SEG,
  })
}

/** Encerra a sessão do portal. */
export async function encerrarSessaoPortal(): Promise<void> {
  const jar = await cookies()
  jar.delete({ name: COOKIE_PORTAL, path: '/' })
  // Limpa também o cookie antigo (path '/portal') de sessões abertas antes do fix.
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

// ── Senha (acesso recorrente, além do magic link) ──────────────────────────────

/** Define/troca a senha do contato (scrypt). O cliente cria a própria no painel. */
export async function definirSenhaPortal(portalUserId: string, senha: string): Promise<void> {
  const hash = await hashSenha(normalizarSenha(senha))
  await sql`update public.portal_users set senha_hash = ${hash} where id = ${portalUserId} and ativo`
}

/** Este contato já tem senha definida? (UI mostra "criar" vs "alterar".) */
export async function portalTemSenha(portalUserId: string): Promise<boolean> {
  const rows = await sql<{ tem: boolean }[]>`
    select senha_hash is not null as tem from public.portal_users where id = ${portalUserId} limit 1
  `
  return rows[0]?.tem ?? false
}

/**
 * Login por e-mail + senha. Devolve o contato ATIVO se a senha confere, senão
 * null. Não distingue "e-mail não existe" de "senha errada" — quem chama dá a
 * mensagem genérica. Se o mesmo e-mail atende 2 clientes, valida a senha contra
 * cada um e entra no primeiro que casar (cada acesso tem sua própria senha).
 */
export async function verificarSenhaPortal(email: string, senha: string): Promise<PortalUser | null> {
  const rows = await sql<(PortalUser & { senha_hash: string | null })[]>`
    select id, org_id, workspace_id, nome, email, ativo, senha_hash
    from public.portal_users
    where lower(email) = lower(${email.trim()}) and ativo and senha_hash is not null
    order by created_at
  `
  for (const r of rows) {
    if (r.senha_hash && await conferirSenha(senha, r.senha_hash)) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { senha_hash, ...user } = r
      return user
    }
  }
  return null
}
