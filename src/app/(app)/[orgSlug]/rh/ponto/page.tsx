import { assertRhAccess } from '@/lib/rh'
import { unwrap } from '@/lib/supabase/unwrap'
import { PontoGestaoClient, type ExtraPend, type JustPend } from './PontoGestaoClient'

export const dynamic = 'force-dynamic'

export default async function PontoGestaoPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertRhAccess(orgSlug)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extras = unwrap<ExtraPend>(await (supabase as any)
    .from('rh_ponto')
    .select('id, data, minutos, saldo_min, acima_10h, rh_colaborador!colaborador_id(nome)')
    .eq('org_id', orgId).eq('extra_status', 'pendente')
    .order('data', { ascending: false }), 'horas extras')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const justs = unwrap<JustPend>(await (supabase as any)
    .from('rh_justificativa')
    .select('id, data_ini, data_fim, tipo, descricao, status, rh_colaborador!colaborador_id(nome)')
    .eq('org_id', orgId).eq('status', 'pendente')
    .order('created_at', { ascending: false }), 'justificativas')

  return <PontoGestaoClient orgSlug={orgSlug} extras={extras} justificativas={justs} />
}
