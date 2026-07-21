import { createMidia } from '@/app/actions/midia'
import { loadMidiaSelectors } from '@/lib/midia-selectors'
import { midiaTextoLegalPadrao } from '@/lib/agency'
import { ExternaForm } from '../ExternaForm'

export default async function NovaExternaPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const { supabase, orgId, clientes, veiculos, fornecedores, members, userId, today } = await loadMidiaSelectors(orgSlug)
  const defaultTextoLegal = await midiaTextoLegalPadrao(supabase, orgId)

  return (
    <ExternaForm
      clientes={clientes}
      veiculos={veiculos}
      fornecedores={fornecedores}
      members={members}
      defaultResponsavelId={userId}
      today={today}
      redirectTo={`/${orgSlug}/midias/externas`}
      submitLabel="Gravar"
      defaultTextoLegal={defaultTextoLegal}
      onSubmit={createMidia.bind(null, orgSlug)}
    />
  )
}
