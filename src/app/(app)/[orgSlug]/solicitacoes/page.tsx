import { listarEntradasCliente } from '@/app/actions/portal'
import { SolicitacoesClient } from './SolicitacoesClient'

export const dynamic = 'force-dynamic'

/** Entradas do cliente (respostas de pendência + solicitações novas) — atendimento. */
export default async function SolicitacoesPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ status?: string }>
}) {
  const { orgSlug } = await params
  const { status } = await searchParams
  const filtro = (['novo', 'lido', 'arquivado', 'todos'].includes(status ?? '') ? status : 'novo') as
    'novo' | 'lido' | 'arquivado' | 'todos'

  const { items, podeGerir } = await listarEntradasCliente(orgSlug, filtro)

  if (!podeGerir) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-16 text-center">
        <h1 className="text-lg font-semibold text-gray-900">Sem acesso</h1>
        <p className="text-sm text-gray-500 mt-2">
          As solicitações de clientes são do time de atendimento. Fale com um administrador
          se precisa acompanhar.
        </p>
      </div>
    )
  }

  return <SolicitacoesClient orgSlug={orgSlug} filtro={filtro} initial={items} />
}
