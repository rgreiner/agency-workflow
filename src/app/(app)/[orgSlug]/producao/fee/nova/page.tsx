import { createProducao } from '@/app/actions/producao'
import { loadProducaoSelectors } from '@/lib/midia-selectors'
import { loadOrgDocs } from '@/lib/agency'
import { FeeForm } from '../FeeForm'

export default async function NovoFeePage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const { supabase, orgId, clientes, members, userId, today } = await loadProducaoSelectors(orgSlug)
  const { nfNotes } = await loadOrgDocs(supabase, orgId)
  const defaultObservacao = nfNotes.map(n => n.text).join('\n')

  return (
    <FeeForm
      clientes={clientes}
      members={members}
      defaultResponsavelId={userId}
      today={today}
      redirectTo={`/${orgSlug}/producao/fee`}
      submitLabel="Gravar"
      defaultObservacao={defaultObservacao}
      onSubmit={createProducao.bind(null, orgSlug)}
    />
  )
}
