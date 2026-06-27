import { createClient } from '@/lib/supabase/server'
import { CategoriasClient } from './CategoriasClient'
import type { FinanceCategoriaGrupo, FinanceCentro } from '@/app/actions/financeiro'

export default async function CategoriasPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const supabase = await createClient()

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: settings } = await (supabase as any)
    .from('org_settings')
    .select('finance_categorias, finance_centros_custo')
    .eq('org_id', org.id)
    .maybeSingle()

  const categorias = (settings?.finance_categorias ?? []) as FinanceCategoriaGrupo[]
  const centros = (settings?.finance_centros_custo ?? []) as FinanceCentro[]

  return <CategoriasClient orgSlug={orgSlug} categorias={categorias} centros={centros} />
}
