import { createMidia } from '@/app/actions/midia'
import { loadMidiaSelectors } from '@/lib/midia-selectors'
import { midiaTextoLegalPadrao } from '@/lib/agency'
import { DigitalForm } from '../DigitalForm'

export default async function NovaDigitalPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const { supabase, orgId, clientes, veiculos, members, userId, today } = await loadMidiaSelectors(orgSlug)
  const defaultTextoLegal = await midiaTextoLegalPadrao(supabase, orgId)

  return (
    <DigitalForm
      clientes={clientes}
      veiculos={veiculos}
      members={members}
      defaultResponsavelId={userId}
      today={today}
      redirectTo={`/${orgSlug}/midias/digitais`}
      submitLabel="Gravar"
      defaultTextoLegal={defaultTextoLegal}
      onSubmit={createMidia.bind(null, orgSlug)}
    />
  )
}
