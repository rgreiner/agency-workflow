import { createMidia } from '@/app/actions/midia'
import { loadMidiaSelectors } from '@/lib/midia-selectors'
import { EletronicaForm } from '../EletronicaForm'

export default async function NovaEletronicaPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const { clientes, veiculos, members, userId, today } = await loadMidiaSelectors(orgSlug)

  return (
    <EletronicaForm
      clientes={clientes}
      veiculos={veiculos}
      members={members}
      defaultResponsavelId={userId}
      today={today}
      redirectTo={`/${orgSlug}/midias/eletronica`}
      submitLabel="Gravar"
      onSubmit={createMidia.bind(null, orgSlug)}
    />
  )
}
