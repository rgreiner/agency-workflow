import { createProducao } from '@/app/actions/producao'
import { loadProducaoSelectors } from '@/lib/midia-selectors'
import { OrcamentoForm } from '../OrcamentoForm'

export default async function NovoOrcamentoPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const { clientes, fornecedores, members, userId, today } = await loadProducaoSelectors(orgSlug)

  return (
    <OrcamentoForm
      clientes={clientes}
      fornecedores={fornecedores}
      members={members}
      defaultResponsavelId={userId}
      today={today}
      redirectTo={`/${orgSlug}/producao/orcamento`}
      submitLabel="Gravar"
      onSubmit={createProducao.bind(null, orgSlug)}
    />
  )
}
