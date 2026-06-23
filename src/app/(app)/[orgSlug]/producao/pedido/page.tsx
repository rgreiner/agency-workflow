import { createClient } from '@/lib/supabase/server'
import { ProducaoClient, type ProducaoRow } from '../ProducaoClient'

export default async function PedidoPage({
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
  const { data: raw } = await (supabase as any)
    .from('producao')
    .select('id, numero, titulo, valor, situacao, archived, workspaces(name)')
    .eq('org_id', org.id).eq('tipo', 'pedido').eq('archived', archivedView)
    .order('numero', { ascending: false })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: ProducaoRow[] = (raw ?? []).map((r: any) => ({
    id: r.id, numero: r.numero, titulo: r.titulo, valor: Number(r.valor ?? 0),
    situacao: r.situacao, archived: r.archived, cliente: r.workspaces?.name ?? '—',
  }))

  return (
    <ProducaoClient
      orgSlug={orgSlug} items={items} archivedView={archivedView}
      basePath="producao/pedido" title="Liberação de Produção — Pedido de produção"
      subtitle="Pedidos aos fornecedores (BV + honorários)" addLabel="Adicionar Pedido"
    />
  )
}
