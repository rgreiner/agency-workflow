import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { EmBreve } from '@/components/ui/EmBreve'

const TITLES: Record<string, string> = {
  lancamentos: 'Financeiro — Lançamentos',
  faturamento: 'Financeiro — Faturamento',
}

export default async function FinanceiroPlaceholderPage({
  params,
}: {
  params: Promise<{ orgSlug: string; secao: string }>
}) {
  const { orgSlug, secao } = await params
  const title = TITLES[secao]
  if (!title) notFound()

  // Gate de permissão: só quem tem can_finance (ou owner/admin) acessa o Financeiro.
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

  return <EmBreve title={title} />
}
