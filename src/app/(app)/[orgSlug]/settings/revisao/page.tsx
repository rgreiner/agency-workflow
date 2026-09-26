import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { lerRevisaoConfigPublica } from '@/lib/ai/revisao-config'
import { geminiConfigured } from '@/lib/ai/gemini'
import { RevisaoClient } from './RevisaoClient'

export const metadata = { title: 'Configurações — Revisão IA' }
// Lê a config pela conexão direta (runtime); nunca no build.
export const dynamic = 'force-dynamic'

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

  const cfg = await lerRevisaoConfigPublica(org.id)
  return <RevisaoClient orgSlug={orgSlug} initial={cfg} geminiNoServidor={geminiConfigured()} />
}
