import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { RevisaoClient } from './RevisaoClient'
import type { ReviewGates } from '@/app/actions/org-settings'

export const metadata = { title: 'Configurações — Revisão IA' }

const DEFAULT_GATES: ReviewGates = { redacao: true, design: true, finalizacao: true }

export default async function RevisaoPage({ params }: { params: Promise<{ orgSlug: string }> }) {
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

  // Ausente/erro = todos ligados (mesmo default do gate em review-gate.ts).
  let gates = DEFAULT_GATES
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: s } = await (supabase as any)
      .from('org_settings').select('review_gates').eq('org_id', org.id).single()
    if (s?.review_gates) gates = { ...DEFAULT_GATES, ...s.review_gates }
  } catch { /* default-on */ }

  return <RevisaoClient orgSlug={orgSlug} orgId={org.id} initial={gates} />
}
