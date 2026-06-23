import { createMidia } from '@/app/actions/midia'
import { loadMidiaSelectors } from '@/lib/midia-selectors'
import { ExternaForm } from '../ExternaForm'

export default async function NovaExternaPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const { clientes, veiculos, members, userId, today } = await loadMidiaSelectors(orgSlug)

  return (
    <ExternaForm
      clientes={clientes}
      veiculos={veiculos}
      members={members}
      defaultResponsavelId={userId}
      today={today}
      redirectTo={`/${orgSlug}/midias/externas`}
      submitLabel="Gravar"
      onSubmit={createMidia.bind(null, orgSlug)}
    />
  )
}
