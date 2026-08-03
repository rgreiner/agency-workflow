import { assertRhAccess } from '@/lib/rh'
import { unwrap } from '@/lib/supabase/unwrap'
import { FolhaClient, type FolhaRow, type PessoaRef } from './FolhaClient'

export const dynamic = 'force-dynamic'

export default async function FolhaPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertRhAccess(orgSlug)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linhas = unwrap<FolhaRow>(await (supabase as any)
    .from('rh_folha')
    .select('competencia, nome, liquido, vencimentos, descontos, inss, fgts, colaborador_id, cpf, tratamento')
    .eq('org_id', orgId)
    .order('competencia', { ascending: false }), 'folha')

  // Para o "a quem pertence este registro?" do import (migration 197).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pessoas = unwrap<PessoaRef>(await (supabase as any)
    .from('rh_colaborador')
    .select('id, nome, cpf')
    .eq('org_id', orgId).eq('arquivado', false)
    .order('nome'), 'colaboradores')

  return <FolhaClient orgSlug={orgSlug} linhas={linhas} pessoas={pessoas} />
}
