import { createProducao } from '@/app/actions/producao'
import { loadProducaoSelectors } from '@/lib/midia-selectors'
import { VendaForm } from '../VendaForm'

export default async function NovaVendaPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const { clientes, members, userId, today } = await loadProducaoSelectors(orgSlug)

  return (
    <VendaForm
      clientes={clientes}
      members={members}
      defaultResponsavelId={userId}
      today={today}
      redirectTo={`/${orgSlug}/producao/venda`}
      submitLabel="Gravar"
      onSubmit={createProducao.bind(null, orgSlug)}
    />
  )
}
