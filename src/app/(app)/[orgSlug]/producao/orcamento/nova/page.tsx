import { createProducao } from '@/app/actions/producao'
import { loadProducaoSelectors } from '@/lib/midia-selectors'
import { OrcamentoForm } from '../OrcamentoForm'

export default async function NovoOrcamentoPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const { supabase, orgId, clientes, fornecedores, members, userId, today } = await loadProducaoSelectors(orgSlug)
  // Histórico de cotações e compras (mig. 389): projeção de custo por item parecido.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: historico } = await (supabase as any).rpc('cotacao_historico', { p_org: orgId })

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
      historico={historico ?? null}
    />
  )
}
