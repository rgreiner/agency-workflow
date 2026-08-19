import { createClient } from '@/lib/supabase/server'
import { ProducaoClient, type ProducaoRow } from '../ProducaoClient'
import { FEE_SITUACAO_OPTIONS, filtrarPorAba } from '@/lib/midia'

export default async function VendaPage({
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
  const baseQ = (supabase as any)
    .from('producao')
    .select('id, numero, serie, titulo, valor, detalhe, situacao, archived, workspaces(name)')
    .eq('org_id', org.id).eq('tipo', 'venda')
  const { data: raw } = await filtrarPorAba(baseQ, archivedView)
    .order('numero', { ascending: false })

  // A lista mostra a COMISSÃO (o que a agência recebe), não a coluna `valor` — que
  // aqui guarda quanto o cliente vendeu. Numa lista de receita, o número que
  // interessa é o que entra no caixa.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: ProducaoRow[] = (raw ?? []).map((r: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parcelas: any[] = Array.isArray(r.detalhe?.parcelas) ? r.detalhe.parcelas : []
    const comissao = parcelas.reduce((s, p) => s + Number(p?.valor ?? 0), 0)
    return {
      id: r.id, numero: r.numero, serie: r.serie, titulo: r.titulo,
      valor: comissao || Number(r.valor ?? 0),
      situacao: r.situacao, archived: r.archived, cliente: r.workspaces?.name ?? '—',
    }
  })

  return (
    <ProducaoClient
      orgSlug={orgSlug} items={items} archivedView={archivedView}
      basePath="producao/venda" title="Liberação de Produção — Receita de Venda"
      subtitle="Comissão sobre as vendas do cliente" addLabel="Adicionar Receita de Venda"
      situacaoOptions={FEE_SITUACAO_OPTIONS}
      // Não é documento que se manda pro cliente: é registro interno da comissão.
      showPrint={false}
    />
  )
}
