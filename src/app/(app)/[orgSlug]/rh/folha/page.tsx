import { assertRhAccess } from '@/lib/rh'
import { unwrap } from '@/lib/supabase/unwrap'
import { FolhaClient, type FolhaRow } from './FolhaClient'

export const dynamic = 'force-dynamic'

export default async function FolhaPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertRhAccess(orgSlug)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linhas = unwrap<FolhaRow>(await (supabase as any)
    .from('rh_folha')
    .select('competencia, nome, liquido, vencimentos, descontos, inss, fgts, colaborador_id')
    .eq('org_id', orgId)
    .order('competencia', { ascending: false }), 'folha')

  return <FolhaClient orgSlug={orgSlug} linhas={linhas} />
}
