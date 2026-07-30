import { redirect } from 'next/navigation'
import { getUsuario } from '@/lib/auth/server'
import { getAccess } from '@/lib/auth/access'

/**
 * Gate do relatório de Horas (gestão ou RH) — mesma régua do `horas_can` no
 * banco. O custo por pessoa só vem preenchido pelas RPCs para quem tem RH.
 */
export async function assertHorasAccess(orgSlug: string) {
  const user = await getUsuario()
  if (!user) redirect('/login')

  const r = await getAccess(orgSlug)
  if (!r) redirect('/')
  if (!r.access.rh) redirect(`/${orgSlug}/dashboard`)

  return { supabase: r.supabase, orgId: r.orgId, userId: r.userId }
}
