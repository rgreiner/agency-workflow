import { assertRhAccess } from '@/lib/rh'
import { unwrap, unwrapOne } from '@/lib/supabase/unwrap'
import { PontoGestaoClient, type ExtraPend, type JustPend } from './PontoGestaoClient'
import type { JornadaVals } from '../JornadaEditor'

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
    .select('id, data_ini, data_fim, tipo, descricao, status, doc_id, hora_entrada, hora_intervalo_ini, hora_intervalo_fim, hora_saida, rh_colaborador!colaborador_id(nome)')
    .eq('org_id', orgId).eq('status', 'pendente')
    .order('created_at', { ascending: false }), 'justificativas')

  // Jornada padrão da org (colaborador_id null) — pode não existir se a org é nova.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jornadaPadrao = unwrapOne<Partial<JornadaVals>>(await (supabase as any)
    .from('rh_jornada')
    .select('entrada, intervalo_ini, intervalo_fim, saida, flex_min, tolerancia_min, dias_semana')
    .eq('org_id', orgId).is('colaborador_id', null).maybeSingle(), 'jornada padrão')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: cfg } = await (supabase as any)
    .from('org_settings').select('ponto_obrigatorio').eq('org_id', orgId).maybeSingle()

  return <PontoGestaoClient
    pontoObrigatorio={!!cfg?.ponto_obrigatorio} orgSlug={orgSlug} extras={extras} justificativas={justs} jornadaPadrao={jornadaPadrao} />
}
