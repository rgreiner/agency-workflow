import { redirect } from 'next/navigation'
import { getUsuario } from '@/lib/auth/server'
import { getAccess } from '@/lib/auth/access'

/**
 * Garante acesso ao RH (owner/admin ou can_rh). Redireciona se não tiver.
 * RH é o dado mais sensível do sistema — o gate é por URL, não só na sidebar.
 */
export async function assertRhAccess(orgSlug: string) {
  const user = await getUsuario()
  if (!user) redirect('/login')

  const r = await getAccess(orgSlug)
  if (!r) redirect('/')
  if (!r.access.rh) redirect(`/${orgSlug}/dashboard`)

  return { supabase: r.supabase, orgId: r.orgId, userId: r.userId }
}
