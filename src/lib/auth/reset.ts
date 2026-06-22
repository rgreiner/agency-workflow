/**
 * Reset de senha do auth próprio: gera/consome tokens (auth.password_reset_tokens)
 * e troca a senha em auth.users. Tudo pela conexão Postgres direta (lib/db).
 * O token é guardado hasheado (sha256); o token cru existe só no link do e-mail.
 */
import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { sql } from '@/lib/db'
import { hashSenha } from './password'

const TTL_MIN = 60 // validade do link: 1 hora

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/** Cria um token de reset para o usuário e devolve o token CRU (vai só no e-mail). */
export async function criarTokenReset(userId: string): Promise<string> {
  const raw = randomBytes(32).toString('hex')
  await sql`
    insert into auth.password_reset_tokens (user_id, token_hash, expires_at)
    values (${userId}, ${hashToken(raw)}, now() + ${TTL_MIN} * interval '1 minute')
  `
  return raw
}

/** Token ainda é válido (não usado, não expirado)? Não consome. */
export async function tokenResetValido(raw: string): Promise<boolean> {
  const rows = await sql<{ ok: boolean }[]>`
    select true as ok from auth.password_reset_tokens
    where token_hash = ${hashToken(raw)} and used_at is null and expires_at > now()
    limit 1
  `
  return rows.length > 0
}

/** Consome o token (uso único, atômico). Devolve o user_id ou null se inválido. */
export async function consumirTokenReset(raw: string): Promise<string | null> {
  const rows = await sql<{ user_id: string }[]>`
    update auth.password_reset_tokens
       set used_at = now()
     where token_hash = ${hashToken(raw)} and used_at is null and expires_at > now()
     returning user_id
  `
  return rows[0]?.user_id ?? null
}

/** Troca a senha do usuário e invalida quaisquer outros tokens pendentes dele. */
export async function redefinirSenhaUsuario(userId: string, novaSenha: string): Promise<void> {
  const hash = await hashSenha(novaSenha)
  await sql`update auth.users set encrypted_password = ${hash} where id = ${userId}`
  await sql`
    update auth.password_reset_tokens set used_at = now()
    where user_id = ${userId} and used_at is null
  `
}
