import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'

/**
 * Garante que o usuário tem acesso ao Financeiro (can_finance ou owner/admin).
 * Redireciona se não tiver. Retorna o client + ids para a página reusar.
 */
export async function assertFinanceAccess(orgSlug: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) redirect('/login')

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) redirect('/')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: m } = await (supabase as any)
    .from('organization_members')
    .select('role, can_finance')
    .eq('org_id', org.id)
    .eq('user_id', user.id)
    .single() as { data: { role: string; can_finance: boolean } | null }

  const allowed = !!m && (m.can_finance || ['owner', 'admin'].includes(m.role))
  if (!allowed) redirect(`/${orgSlug}/dashboard`)

  return { supabase, orgId: org.id as string, userId: user.id as string }
}

/**
 * Garante acesso de gestão — SÓ o proprietário (owner) do ambiente. Usado pelo
 * Dashboard gerencial. Redireciona se não for. Retorna client + ids.
 */
export async function assertManageAccess(orgSlug: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) redirect('/login')

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) redirect('/')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: m } = await (supabase as any)
    .from('organization_members')
    .select('role')
    .eq('org_id', org.id)
    .eq('user_id', user.id)
    .single() as { data: { role: string } | null }

  const allowed = !!m && m.role === 'owner'
  if (!allowed) redirect(`/${orgSlug}/dashboard`)

  return { supabase, orgId: org.id as string, userId: user.id as string }
}
