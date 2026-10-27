import { createClient } from '@/lib/supabase/server'
import { filtrarPorAba, producaoDe } from '@/lib/midia'
import { loadViewPrefs } from '@/app/actions/prefs'
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
  const baseQ = (supabase as any)
    .from('midias')
    .select('id, numero, serie, titulo, tipo, valor, desconto_pct, faturamento, situacao, archived, primeira_veiculacao, ultima_veiculacao, detalhe, workspaces(name), veiculos(name)')
    .eq('org_id', org.id).eq('tipo', 'externa')
  const { data: raw } = await filtrarPorAba(baseQ, archivedView)
    .order('numero', { ascending: false })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const midias: MidiaRow[] = (raw ?? []).map((m: any) => ({
    id: m.id, numero: m.numero, serie: m.serie, titulo: m.titulo, tipo: m.tipo,
    valor: Number(m.valor ?? 0), desconto_pct: Number(m.desconto_pct ?? 0),
    faturamento: m.faturamento, situacao: m.situacao, archived: m.archived, inicio: m.primeira_veiculacao ?? null, fim: m.ultima_veiculacao ?? null,
    cliente: m.workspaces?.name ?? '—', veiculo: m.veiculos?.name ?? '—',
    // Lona/adesivo: a produção fica em `detalhe`, fora de `valor` — sem isto a
    // MX só de produção aparecia como R$ 0,00 na lista.
    producao: producaoDe(m.detalhe),
  }))

  return (
    <MidiasClient
      prefs={await loadViewPrefs(orgSlug, 'liberacao:externas')}
      prefsView="liberacao:externas"
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
