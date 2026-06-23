import { createProducao } from '@/app/actions/producao'
import { loadProducaoSelectors } from '@/lib/midia-selectors'
import { PedidoForm } from '../PedidoForm'

export default async function NovoPedidoPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const { clientes, fornecedores, members, userId, today } = await loadProducaoSelectors(orgSlug)

  return (
    <PedidoForm
      clientes={clientes}
      fornecedores={fornecedores}
      members={members}
      defaultResponsavelId={userId}
      today={today}
      redirectTo={`/${orgSlug}/producao/pedido`}
      submitLabel="Gravar"
      onSubmit={createProducao.bind(null, orgSlug)}
    />
  )
}
