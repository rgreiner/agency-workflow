import { assertRhAccess } from '@/lib/rh'
import { unwrap } from '@/lib/supabase/unwrap'
import { ReajusteClient, type LoteRef } from './ReajusteClient'

export const dynamic = 'force-dynamic'

export default async function ReajustePage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertRhAccess(orgSlug)

  // Reajustes coletivos já aplicados (um evento por pessoa, agrupados por lote).
  interface EventoLote {
    lote_id: string; data_efeito: string; percentual: number | null
    titulo: string | null; created_at: string
  }
  const eventos = unwrap<EventoLote>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('rh_evento')
      .select('lote_id, data_efeito, percentual, titulo, created_at')
      .eq('org_id', orgId).eq('tipo', 'reajuste').not('lote_id', 'is', null)
      .order('data_efeito', { ascending: false }), 'reajustes')

  const lotes: LoteRef[] = Object.values(
    eventos.reduce((acc: Record<string, LoteRef>, e) => {
      const k = e.lote_id
      if (!acc[k]) acc[k] = { lote_id: k, data_efeito: e.data_efeito, percentual: e.percentual, titulo: e.titulo, pessoas: 0, created_at: e.created_at }
      acc[k].pessoas++
      return acc
    }, {}),
  )

  return <ReajusteClient orgSlug={orgSlug} lotes={lotes} />
}
