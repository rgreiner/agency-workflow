import { notFound } from 'next/navigation'
import { getAccess } from '@/lib/auth/access'
import { loadAutorizacao } from '@/lib/pdf/autorizacao-data'
import { AutorizacaoClient, type ClienteOpcao } from './AutorizacaoClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Relatório de autorização — Flow' }

/** Mês anterior: é o que se fecha, e o relatório só sai a partir do dia 5. */
function competenciaPadrao(): string {
  const agora = new Date()
  const d = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - 1, 1))
  return d.toISOString().slice(0, 7)
}

export default async function AutorizacaoPage({ params, searchParams }: {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ cliente?: string; comp?: string }>
}) {
  const { orgSlug } = await params
  const { cliente, comp } = await searchParams

  const ctx = await getAccess(orgSlug)
  if (!ctx) notFound()
  // Quem enxerga mídia OU produção enxerga o relatório: ele fala das duas, e
  // não é informação financeira restrita — é a lista que vai ao cliente.
  if (!ctx.access.midias && !ctx.access.producao) notFound()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = ctx.supabase as any

  const { data: wsRaw } = await sb.from('workspaces')
    .select('id, name').eq('org_id', ctx.orgId).order('name')
  const clientes: ClienteOpcao[] = ((wsRaw ?? []) as { id: string; name: string }[])
    .map(w => ({ id: w.id, nome: w.name }))

  const competencia = comp && /^\d{4}-\d{2}$/.test(comp) ? comp : competenciaPadrao()
  const clienteId = cliente || clientes[0]?.id || null

  const dados = clienteId ? await loadAutorizacao(sb, ctx.orgId, clienteId, competencia) : null

  return (
    <AutorizacaoClient
      orgSlug={orgSlug}
      clientes={clientes}
      clienteId={clienteId}
      competencia={competencia}
      dados={dados}
    />
  )
}
