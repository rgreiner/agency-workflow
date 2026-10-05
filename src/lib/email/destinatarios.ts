import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Cópias financeiras do cliente — quem mais precisa receber a cobrança.
 *
 * O cadastro do cliente tem UM `finance_email` (o destinatário) e uma lista
 * `emails[]` com tipo. A régua sempre mandou só para o primeiro, e os demais
 * ficavam no cadastro sem nunca receber nada. Medido em 05/10/2026: a Comil tem
 * "Financeiro CC: lucas.castanha@comil.com.br" cadastrado desde sempre e nunca
 * recebeu uma cobrança.
 *
 * Entram as entradas cujo TIPO fala de financeiro — a mesma régua que a tela de
 * contatos já usa para destacar o e-mail da NF. Um contato "comercial" não é
 * destinatário de cobrança, e mandar cobrança para quem não cuida de pagamento
 * é como mandar para ninguém, com o agravante de constranger.
 */
export async function copiasFinanceiras(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  orgId: string,
  opts: { workspaceId?: string | null; emailPrincipal?: string | null },
): Promise<string[]> {
  const principal = (opts.emailPrincipal ?? '').trim().toLowerCase()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any).from('workspaces').select('emails').eq('org_id', orgId)
  if (opts.workspaceId) q = q.eq('id', opts.workspaceId)
  else if (principal) q = q.ilike('finance_email', principal)
  else return []

  const { data } = await q.limit(1).maybeSingle()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lista = (Array.isArray(data?.emails) ? data.emails : []) as any[]
  const vistos = new Set<string>(principal ? [principal] : [])
  const out: string[] = []
  for (const e of lista) {
    const email = String(e?.email ?? '').trim()
    const tipo = String(e?.tipo ?? '')
    if (!email || !/financ/i.test(tipo)) continue
    const chave = email.toLowerCase()
    // Dedupe: 3 dos 6 cadastros repetem o próprio finance_email na lista.
    if (vistos.has(chave)) continue
    vistos.add(chave)
    out.push(email)
  }
  return out
}
