import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { certificadoPublico } from '@/lib/fiscal/certificado'
import { lerConfigNfse } from '@/app/actions/nfse'
import { FiscalClient } from './FiscalClient'

export const metadata = { title: 'Configurações — Nota fiscal' }
// Lê pela conexão direta (runtime); nunca no build.
export const dynamic = 'force-dynamic'

export default async function FiscalPage({ params }: { params: Promise<{ orgSlug: string }> }) {
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

  const [cert, { cfg }] = await Promise.all([certificadoPublico(org.id), lerConfigNfse(orgSlug)])
  return <FiscalClient orgSlug={orgSlug} inicial={cert} cfgInicial={cfg} />
}
