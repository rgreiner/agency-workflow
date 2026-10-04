import { createProducao } from '@/app/actions/producao'
import { loadProducaoSelectors } from '@/lib/midia-selectors'
import { referenciaDeComissao } from '@/lib/producao/comissao-referencia'
import { PedidoForm } from '../PedidoForm'

export default async function NovoPedidoPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const { supabase, orgId, clientes, fornecedores, members, userId, today } = await loadProducaoSelectors(orgSlug)
  const comissaoRef = await referenciaDeComissao(supabase, orgId)

  return (
    <PedidoForm
      clientes={clientes}
      fornecedores={fornecedores}
      members={members}
      defaultResponsavelId={userId}
      today={today}
      comissaoRef={comissaoRef}
      redirectTo={`/${orgSlug}/producao/pedido`}
      submitLabel="Gravar"
      onSubmit={createProducao.bind(null, orgSlug)}
    />
  )
}
