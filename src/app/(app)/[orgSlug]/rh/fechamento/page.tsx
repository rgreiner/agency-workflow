import { assertRhAccess } from '@/lib/rh'
import { unwrapOne } from '@/lib/supabase/unwrap'
import { hojeBRT } from '@/lib/hoje'
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

  return <FechamentoClient orgSlug={orgSlug} config={config} hoje={hojeBRT()} />
}
