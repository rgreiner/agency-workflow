import 'server-only'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'

/**
 * Garante acesso a uma área do Operacional. Owner/admin sempre podem; senão exige
 * a flag indicada (`can_finance` p/ Financeiro, `can_vendas` p/ Mídias/Produção/
 * Cadastros). Redireciona p/ a home da org se não tiver permissão. Usado nos
 * layouts dessas rotas (bloqueia por URL, não só esconde na sidebar).
 */
async function requireOperacional(orgSlug: string, flag: 'can_finance' | 'can_vendas'): Promise<void> {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) redirect('/login')

  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) redirect('/')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: m } = await (supabase as any)
    .from('organization_members').select(`role, ${flag}`)
    .eq('org_id', org.id).eq('user_id', user.id).single() as { data: Record<string, unknown> | null }

  const allowed = !!m && (!!m[flag] || ['owner', 'admin'].includes(String(m.role)))
  if (!allowed) redirect(`/${orgSlug}`)
}

/** Financeiro: exige can_finance (ou owner/admin). */
export function requireFinanceiro(orgSlug: string): Promise<void> {
  return requireOperacional(orgSlug, 'can_finance')
}

/** Mídias / Produção / Cadastros: exige can_vendas (ou owner/admin). */
export function requireVendas(orgSlug: string): Promise<void> {
  return requireOperacional(orgSlug, 'can_vendas')
}
