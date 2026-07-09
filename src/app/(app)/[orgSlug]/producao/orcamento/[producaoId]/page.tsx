import { notFound } from 'next/navigation'
import { updateProducao } from '@/app/actions/producao'
import { loadProducaoSelectors } from '@/lib/midia-selectors'
import { OrcamentoForm, type OrcamentoValues, type ItemOrc } from '../OrcamentoForm'

function s(v: unknown): string { return v == null ? '' : String(v) }
function num2br(v: unknown): string {
  if (v == null || v === '') return ''
  const n = Number(v)
  return isNaN(n) ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default async function EditarOrcamentoPage({
  params,
}: {
  params: Promise<{ orgSlug: string; producaoId: string }>
}) {
  const { orgSlug, producaoId } = await params
  const { supabase, clientes, fornecedores, members, userId, today } = await loadProducaoSelectors(orgSlug)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: p } = await (supabase as any).from('producao').select('*').eq('id', producaoId).single()
  if (!p) notFound()

  const det = (p.detalhe ?? {}) as { itens?: ItemOrc[] }

  const initial: OrcamentoValues = {
    workspace_id: s(p.workspace_id), campaign_id: s(p.campaign_id), faturar: s(p.faturar) || 'contra_cliente',
    emissao: s(p.emissao), validade_dias: s(p.validade_dias), bv_pct: num2br(p.bv_pct),
    titulo: s(p.titulo),
    honorarios_pct: num2br(p.honorarios_pct), contato: s(p.contato), responsavel_id: s(p.responsavel_id),
    situacao: s(p.situacao) || 'em_aberto', observacao: s(p.observacao), texto_legal: s(p.texto_legal),
    itens: Array.isArray(det.itens) ? det.itens : [],
  }

  return (
    <OrcamentoForm
      clientes={clientes}
      fornecedores={fornecedores}
      members={members}
      defaultResponsavelId={userId}
      today={today}
      redirectTo={`/${orgSlug}/producao/orcamento`}
      initial={initial}
      submitLabel="Salvar"
      onSubmit={updateProducao.bind(null, orgSlug, producaoId)}
    />
  )
}
