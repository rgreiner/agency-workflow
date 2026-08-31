import { assertRhAccess } from '@/lib/rh'
import { unwrap, unwrapOne } from '@/lib/supabase/unwrap'
import { hojeBRT } from '@/lib/hoje'
import type { RunRh } from '@/app/actions/rh-fechamento'
import { FechamentoClient, type FechConfig } from './FechamentoClient'

export const dynamic = 'force-dynamic'

export default async function FechamentoPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertRhAccess(orgSlug)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config = unwrapOne<FechConfig>(await (supabase as any)
    .from('rh_fechamento_config')
    .select('dia_ini, dia_pagamento, paga_mes_seguinte')
    .eq('org_id', orgId).maybeSingle(), 'config do fechamento')

  // Ciclos congelados (mig. 256) — o histórico navegável e o material do envio.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runs = unwrap<RunRh>(await (supabase as any)
    .from('rh_fechamento_run')
    .select('id, competencia, ini, fim, status, versao, fechado_em, reaberto_em, reaberto_motivo, enviado_em, destinatarios, envios, sem_envio, vr_valor, vt_valor, corpo, rh_fechamento_run_linha(colaborador_id, nome, cpf, cargo, ini, fim, hn_min, he50_min, he100_min, faltas_min, total_min, quitacao_min, pendente_min, dias_com_ponto)')
    .eq('org_id', orgId)
    .order('competencia', { ascending: false }), 'fechamentos')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: cfgRh } = await (supabase as any)
    .from('org_settings').select('rh_contabil_emails').eq('org_id', orgId).maybeSingle()

  return <FechamentoClient orgSlug={orgSlug} config={config} hoje={hojeBRT()}
    runs={runs} emailsContab={(cfgRh?.rh_contabil_emails ?? []) as string[]} />
}
