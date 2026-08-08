import { assertRhAccess } from '@/lib/rh'
import { unwrap } from '@/lib/supabase/unwrap'
import { AvaliacaoClient } from './AvaliacaoClient'
import type { Ciclo } from '@/app/actions/rh-avaliacao'

export const dynamic = 'force-dynamic'

export default async function AvaliacaoPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertRhAccess(orgSlug)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ciclos = unwrap<Ciclo>(await (supabase as any)
    .from('rh_aval_ciclo')
    .select('id, nome, tipo, status, abre_em, fecha_em, min_respondentes, ident_par, ident_ascendente, encerrado_em')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false }), 'ciclos de avaliação')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: competencias } = await (supabase as any)
    .from('rh_aval_competencia').select('id', { count: 'exact', head: true }).eq('org_id', orgId)

  // Quem ainda não tem função definida responde só o núcleo comum — vale avisar.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const semFuncao = unwrap<{ id: string; nome: string }>(await (supabase as any)
    .from('rh_colaborador').select('id, nome')
    .eq('org_id', orgId).eq('status', 'ativo').eq('arquivado', false)
    .is('aval_funcao', null), 'sem função')

  return <AvaliacaoClient orgSlug={orgSlug} ciclos={ciclos}
    temCompetencias={(competencias ?? 0) > 0} semFuncao={semFuncao} />
}
