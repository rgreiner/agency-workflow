import { createClient } from '@/lib/supabase/server'
import { MidiasClient, type MidiaRow } from '../simplificada/MidiasClient'

export default async function MidiasExternasPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ view?: string }>
}) {
  const { orgSlug } = await params
  const { view } = await searchParams
  const archivedView = view === 'arquivadas'
  const supabase = await createClient()

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: raw } = await (supabase as any)
    .from('midias')
    .select('id, numero, serie, titulo, tipo, valor, desconto_pct, faturamento, situacao, archived, workspaces(name), veiculos(name)')
    .eq('org_id', org.id).eq('tipo', 'externa').eq('archived', archivedView)
    .order('numero', { ascending: false })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const midias: MidiaRow[] = (raw ?? []).map((m: any) => ({
    id: m.id, numero: m.numero, serie: m.serie, titulo: m.titulo, tipo: m.tipo,
    valor: Number(m.valor ?? 0), desconto_pct: Number(m.desconto_pct ?? 0),
    faturamento: m.faturamento, situacao: m.situacao, archived: m.archived,
    cliente: m.workspaces?.name ?? '—', veiculo: m.veiculos?.name ?? '—',
  }))

  return (
    <MidiasClient
      orgSlug={orgSlug}
      midias={midias}
      archivedView={archivedView}
      basePath="midias/externas"
      title="Liberação de mídias — Externas"
      subtitle="Outdoor e mídia externa"
      addLabel="Adicionar Mídia Externa"
    />
  )
}
