import 'server-only'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'

/**
 * Garante acesso ao módulo Operacional (Mídias / Produção / Financeiro / Cadastros).
 * Regra = mesma do Financeiro: `can_finance` ou owner/admin. Redireciona p/ a home
 * da org se não tiver permissão. Usado nos layouts dessas rotas (bloqueia por URL,
 * não só esconde na sidebar).
 */
export async function requireOperacional(orgSlug: string): Promise<void> {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) redirect('/login')

  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) redirect('/')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: m } = await (supabase as any)
    .from('organization_members').select('role, can_finance')
    .eq('org_id', org.id).eq('user_id', user.id).single() as { data: { role: string; can_finance: boolean } | null }

  const allowed = !!m && (m.can_finance || ['owner', 'admin'].includes(m.role))
  if (!allowed) redirect(`/${orgSlug}`)
}
