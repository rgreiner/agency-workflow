import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { loadOrgDocs } from '@/lib/agency'
import { certificadoPublico } from '@/lib/fiscal/certificado'
import { DocumentosClient } from './DocumentosClient'

export const metadata = { title: 'Configurações — Documentos' }

export default async function DocumentosPage({ params }: { params: Promise<{ orgSlug: string }> }) {
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

  const docs = await loadOrgDocs(supabase, org.id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: settings } = await (supabase as any).from('org_settings').select('payment_info, pix_chave, pix_nome, pix_cidade').eq('org_id', org.id).maybeSingle()

  // O CNPJ do CERTIFICADO é a fonte boa para sugerir a chave Pix: é o mesmo CNPJ
  // que assina a NFS-e, lido do arquivo e não digitado. Chave Pix com um dígito
  // trocado não dá erro — manda o dinheiro para outra empresa.
  const cert = await certificadoPublico(org.id)
  const cnpjSugerido = (cert?.cnpj ?? '').replace(/\D/g, '')

  return <DocumentosClient orgSlug={orgSlug} orgId={org.id} initial={docs} initialPaymentInfo={settings?.payment_info ?? ''}
    initialPix={{
      chave: settings?.pix_chave ?? '', nome: settings?.pix_nome ?? '', cidade: settings?.pix_cidade ?? '',
    }}
    cnpjSugerido={cnpjSugerido} />
}
