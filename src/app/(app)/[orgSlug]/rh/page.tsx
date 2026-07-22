import { assertRhAccess } from '@/lib/rh'
import { unwrap } from '@/lib/supabase/unwrap'
import { PessoasClient, type ColaboradorRow } from './PessoasClient'

export const dynamic = 'force-dynamic'

export default async function RhPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertRhAccess(orgSlug)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const colaboradores = unwrap<ColaboradorRow>(await (supabase as any)
    .from('rh_colaborador')
    .select('id, nome, cargo, tipo_vinculo, status, data_admissao, data_demissao, arquivado')
    .eq('org_id', orgId)
    .order('arquivado', { ascending: true })
    .order('status', { ascending: true })
    .order('nome', { ascending: true }), 'colaboradores')

  return <PessoasClient orgSlug={orgSlug} colaboradores={colaboradores} />
}
