import { notFound } from 'next/navigation'
import { assertRhAccess } from '@/lib/rh'
import { unwrapOne } from '@/lib/supabase/unwrap'
import { CicloClient } from './CicloClient'
import type { Ciclo } from '@/app/actions/rh-avaliacao'

export const dynamic = 'force-dynamic'

export default async function CicloPage({ params }: { params: Promise<{ orgSlug: string; cicloId: string }> }) {
  const { orgSlug, cicloId } = await params
  const { supabase, orgId } = await assertRhAccess(orgSlug)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ciclo = unwrapOne<Ciclo>(await (supabase as any)
    .from('rh_aval_ciclo')
    .select('id, nome, tipo, status, abre_em, fecha_em, min_respondentes, ident_par, ident_ascendente, encerrado_em')
    .eq('id', cicloId).eq('org_id', orgId).maybeSingle(), 'ciclo')
  if (!ciclo) notFound()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: progresso } = await (supabase as any).rpc('rh_aval_progresso', { p_ciclo: cicloId })

  return <CicloClient orgSlug={orgSlug} ciclo={ciclo} progresso={progresso ?? { por_avaliado: [], por_avaliador: [] }} />
}
