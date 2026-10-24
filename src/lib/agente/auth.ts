/**
 * Autenticação da API de agentes (Digitais). O agente manda
 * `Authorization: Bearer <token>`; aqui o token vira a usuária dele no Flow.
 *
 * O token só existe em sha256 (`agente_tokens`, sem policy — só a conexão
 * direta lê). Daí sai um JWT de 5 min da usuária, e TODO o resto passa pelo
 * PostgREST com ele: RLS, travas de mês fechado e autoria iguais às da tela.
 */
import 'server-only'
import { createHash } from 'node:crypto'
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { sql } from '@/lib/db'
import { mintAgenteToken } from '@/lib/auth/jwt'

export interface AgenteFlow {
  orgId: string
  userId: string
  nome: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function autenticarAgente(req: Request): Promise<AgenteFlow | null> {
  const m = /^Bearer\s+(\S{32,})$/.exec(req.headers.get('authorization') ?? '')
  if (!m) return null
  const rows = await sql<{ id: string; org_id: string; user_id: string; nome: string; email: string }[]>`
    select t.id, t.org_id, t.user_id, t.nome, u.email
    from public.agente_tokens t
    join auth.users u on u.id = t.user_id
    where t.token_hash = ${hashToken(m[1])} and t.revogado_em is null
    limit 1
  `
  const t = rows[0]
  if (!t) return null
  // Não segura a resposta: é só para saber se o agente está vivo.
  sql`update public.agente_tokens set ultimo_uso_em = now() where id = ${t.id}`.catch(() => {})

  const jwt = await mintAgenteToken({ sub: t.user_id, email: t.email })
  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { accessToken: async () => jwt, auth: { persistSession: false, autoRefreshToken: false } },
  )
  return { orgId: t.org_id, userId: t.user_id, nome: t.nome, supabase }
}
