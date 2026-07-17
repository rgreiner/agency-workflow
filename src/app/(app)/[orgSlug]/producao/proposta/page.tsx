import { createClient } from '@/lib/supabase/server'
import { filtrarPorAba, SITUACOES_FORA_PROPOSTA } from '@/lib/midia'
import { ProducaoClient, type ProducaoRow } from '../ProducaoClient'

export default async function PropostaPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ view?: string }>
}) {
  const { orgSlug } = await params
  const { view } = await searchParams
  const archivedView = view === 'arquivados'
  const supabase = await createClient()

  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return null

  // Só saem da aba Ativos quando faturado ou cancelado (o resto segue visível).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseQ = (supabase as any)
    .from('producao')
    .select('id, numero, serie, titulo, valor, situacao, archived, workspaces(name)')
    .eq('org_id', org.id).eq('tipo', 'proposta')
  const { data: raw } = await filtrarPorAba(baseQ, archivedView, SITUACOES_FORA_PROPOSTA)
    .order('numero', { ascending: false })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: ProducaoRow[] = (raw ?? []).map((r: any) => ({
    id: r.id, numero: r.numero, serie: r.serie, titulo: r.titulo, valor: Number(r.valor ?? 0),
    situacao: r.situacao, archived: r.archived, cliente: r.workspaces?.name ?? '—',
  }))

  return (
    <ProducaoClient
      orgSlug={orgSlug} items={items} archivedView={archivedView}
      basePath="producao/proposta" title="Liberação de Produção — Proposta"
      subtitle="Propostas avulsas ao cliente (mídia, produção, serviço, fee)" addLabel="Adicionar Proposta"
      gerarDocs
    />
  )
}
