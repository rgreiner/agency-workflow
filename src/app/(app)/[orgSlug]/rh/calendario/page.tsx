import { assertRhAccess } from '@/lib/rh'
import { unwrap } from '@/lib/supabase/unwrap'
import { hojeBRT } from '@/lib/hoje'
import { CalendarioClient } from './CalendarioClient'
import type { Feriado } from '@/app/actions/rh-calendario'

export const dynamic = 'force-dynamic'

export default async function CalendarioPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertRhAccess(orgSlug)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const feriados = unwrap<Feriado>(await (supabase as any)
    .from('rh_feriado')
    .select('id, data, nome, tipo, abona, extra_100')
    .eq('org_id', orgId)
    .order('data', { ascending: true }), 'feriados')

  return <CalendarioClient orgSlug={orgSlug} feriados={feriados} hoje={hojeBRT()} />
}
