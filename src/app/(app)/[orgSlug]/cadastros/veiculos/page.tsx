import { createClient } from '@/lib/supabase/server'
import { VeiculosClient, type Veiculo } from './VeiculosClient'

export default async function VeiculosPage({
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

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: veiculosRaw } = await (supabase as any)
    .from('veiculos')
    .select('id, name, type, tax_id, commission_pct, notes, archived')
    .eq('org_id', org.id)
    .eq('archived', archivedView)
    .order('name', { ascending: true })

  const veiculos = (veiculosRaw ?? []) as Veiculo[]

  return (
    <VeiculosClient orgSlug={orgSlug} veiculos={veiculos} archivedView={archivedView} />
  )
}
