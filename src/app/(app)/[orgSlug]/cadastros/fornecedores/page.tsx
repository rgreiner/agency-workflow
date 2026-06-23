import { createClient } from '@/lib/supabase/server'
import { FornecedoresClient, type Fornecedor } from './FornecedoresClient'

export default async function FornecedoresPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ view?: string }>
}) {
  const { orgSlug } = await params
  const { view } = await searchParams
  const archivedView = view === 'arquivados'
  const supabase = await createClient()

  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: raw } = await (supabase as any)
    .from('fornecedores').select('id, name, tipo, tax_id, notes, archived')
    .eq('org_id', org.id).eq('archived', archivedView).order('name', { ascending: true })

  const fornecedores = (raw ?? []) as Fornecedor[]
  return <FornecedoresClient orgSlug={orgSlug} fornecedores={fornecedores} archivedView={archivedView} />
}
