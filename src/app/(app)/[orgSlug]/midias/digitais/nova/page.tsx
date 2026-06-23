import { createMidia } from '@/app/actions/midia'
import { loadMidiaSelectors } from '@/lib/midia-selectors'
import { DigitalForm } from '../DigitalForm'

export default async function NovaDigitalPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const { clientes, veiculos, members, userId, today } = await loadMidiaSelectors(orgSlug)

  return (
    <DigitalForm
      clientes={clientes}
      veiculos={veiculos}
      members={members}
      defaultResponsavelId={userId}
      today={today}
      redirectTo={`/${orgSlug}/midias/digitais`}
      submitLabel="Gravar"
      onSubmit={createMidia.bind(null, orgSlug)}
    />
  )
}
