import { createProducao } from '@/app/actions/producao'
import { loadProducaoSelectors } from '@/lib/midia-selectors'
import { PropostaForm } from '../PropostaForm'

export default async function NovaPropostaPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const { clientes, members, userId, today } = await loadProducaoSelectors(orgSlug)

  return (
    <PropostaForm
      clientes={clientes}
      members={members}
      defaultResponsavelId={userId}
      today={today}
      redirectTo={`/${orgSlug}/producao/proposta`}
      submitLabel="Gravar"
      onSubmit={createProducao.bind(null, orgSlug)}
    />
  )
}
