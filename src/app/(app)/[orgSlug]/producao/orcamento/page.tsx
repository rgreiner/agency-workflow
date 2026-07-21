import { createClient } from '@/lib/supabase/server'
import { filtrarPorAba, SITUACOES_FORA_ORCAMENTO, ORCAMENTO_SITUACAO_OPTIONS } from '@/lib/midia'
import { ProducaoClient, type ProducaoRow } from '../ProducaoClient'

export default async function OrcamentoPage({
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // Saem da aba Ativos quando faturado, cancelado ou concluído (= já virou PP).
  const baseQ = sb
    .from('producao')
    .select('id, numero, serie, titulo, valor, situacao, archived, workspaces(name)')
    .eq('org_id', org.id).eq('tipo', 'orcamento')
  const { data: raw } = await filtrarPorAba(baseQ, archivedView, SITUACOES_FORA_ORCAMENTO)
    .order('numero', { ascending: false })

  // PPs já geradas por estes orçamentos (migration 137): a linha mostra o vínculo e o
  // botão "Gerar PPs" some — é o que impede gerar duas vezes sem perceber.
  const ids = (raw ?? []).map((r: { id: string }) => r.id)
  const { data: ppsRaw } = ids.length
    ? await sb.from('producao')
        .select('id, serie, numero, origem_orcamento_id')
        .in('origem_orcamento_id', ids).order('numero')
    : { data: [] }
  const gerados: Record<string, { id: string; serie: string | null; numero: number | null }[]> = {}
  for (const pp of (ppsRaw ?? []) as { id: string; serie: string | null; numero: number | null; origem_orcamento_id: string }[]) {
    ;(gerados[pp.origem_orcamento_id] ??= []).push({ id: pp.id, serie: pp.serie, numero: pp.numero })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: ProducaoRow[] = (raw ?? []).map((r: any) => ({
    id: r.id, numero: r.numero, serie: r.serie, titulo: r.titulo, valor: Number(r.valor ?? 0),
    situacao: r.situacao, archived: r.archived, cliente: r.workspaces?.name ?? '—',
    gerados: gerados[r.id] ?? [],
  }))

  return (
    <ProducaoClient
      orgSlug={orgSlug} items={items} archivedView={archivedView}
      basePath="producao/orcamento" title="Liberação de Produção — Orçamento"
      subtitle="Cotações de fornecedores para aprovação do cliente" addLabel="Adicionar Orçamento"
      gerarPedidos situacaoOptions={ORCAMENTO_SITUACAO_OPTIONS}
    />
  )
}
