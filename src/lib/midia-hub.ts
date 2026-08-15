import 'server-only'
import { redirect } from 'next/navigation'
import { getUsuario } from '@/lib/auth/server'
import { getAccess } from '@/lib/auth/access'

/**
 * Gate do Hub de Mídia — por URL, não só escondido na sidebar.
 * O toggle é `op_midia_hub` do cargo (ver migration 234): `op_midias` não serve
 * porque é o gate do COMERCIAL de mídia e está ligado também na Revisão.
 */
export async function assertMidiaAccess(orgSlug: string) {
  const user = await getUsuario()
  if (!user) redirect('/login')

  const r = await getAccess(orgSlug)
  if (!r) redirect('/')
  if (!r.access.midiaHub) redirect(`/${orgSlug}/dashboard`)

  return { supabase: r.supabase, orgId: r.orgId, userId: r.userId, access: r.access }
}

/** Fila da mídia quando a org não configurou os status do cargo. */
export const MIDIA_STATUS_FALLBACK = [
  'validacao_midia', 'midia', 'social', 'implantacao_digital', 'implantacao_off',
]

/**
 * Status que a fila do Hub observa: a união dos `allowed_statuses` dos cargos
 * que operam mídia, sem o de conclusão. Sai do cadastro em vez de uma lista
 * fixa no código — status virou cadastro da org na migration 168.
 */
export async function statusDaMidia(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, orgId: string,
): Promise<string[]> {
  const [{ data: pos }, { data: fim }] = await Promise.all([
    supabase.from('org_positions').select('allowed_statuses').eq('org_id', orgId).eq('op_midia_hub', true),
    supabase.from('org_status').select('valor').eq('org_id', orgId).eq('papel', 'conclusao'),
  ])
  const conclusao = new Set<string>((fim ?? []).map((s: { valor: string }) => s.valor))
  const set = new Set<string>()
  for (const p of (pos ?? []) as { allowed_statuses: string[] | null }[]) {
    for (const s of p.allowed_statuses ?? []) if (!conclusao.has(s)) set.add(s)
  }
  return set.size ? [...set] : MIDIA_STATUS_FALLBACK.filter(s => !conclusao.has(s))
}
