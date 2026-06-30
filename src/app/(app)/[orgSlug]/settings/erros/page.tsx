import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { ErrosClient, type SystemError } from './ErrosClient'

export const metadata = { title: 'Configurações — Erros do sistema' }

export default async function ErrosPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) redirect('/login')

  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) redirect('/')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: m } = await (supabase as any)
    .from('organization_members').select('role').eq('org_id', org.id).eq('user_id', user.id).single() as { data: { role: string } | null }
  if (!m || !['owner', 'admin'].includes(m.role)) redirect(`/${orgSlug}/settings/membros`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('system_errors')
    .select('id, context, message, detail, activity_id, resolved, created_at')
    .eq('org_id', org.id)
    .order('created_at', { ascending: false })
    .limit(200)

  return <ErrosClient orgSlug={orgSlug} erros={(data ?? []) as SystemError[]} />
}
