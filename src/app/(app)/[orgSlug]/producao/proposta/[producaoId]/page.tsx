import { notFound } from 'next/navigation'
import { updateProducao } from '@/app/actions/producao'
import { loadProducaoSelectors } from '@/lib/midia-selectors'
import { PropostaForm, type PropostaValues, type ItemProposta, type ParcelaProposta } from '../PropostaForm'

function s(v: unknown): string { return v == null ? '' : String(v) }
function num2br(v: unknown): string {
  if (v == null || v === '') return ''
  const n = Number(v)
  return isNaN(n) ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default async function EditarPropostaPage({
  params,
}: {
  params: Promise<{ orgSlug: string; producaoId: string }>
}) {
  const { orgSlug, producaoId } = await params
  const { supabase, clientes, members, userId, today } = await loadProducaoSelectors(orgSlug)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: p } = await (supabase as any).from('producao').select('*').eq('id', producaoId).single()
  if (!p) notFound()

  const det = (p.detalhe ?? {}) as { agrupar_faturamento?: string; prazo?: string; data_base?: string; introducao?: string; itens?: ItemProposta[]; parcelas?: ParcelaProposta[] }

  const initial: PropostaValues = {
    workspace_id: s(p.workspace_id), campaign_id: s(p.campaign_id), titulo: s(p.titulo),
    emissao: s(p.emissao), validade_dias: s(p.validade_dias),
    agrupar_faturamento: s(det.agrupar_faturamento) || 'na_proposta',
    prazo: s(det.prazo) || 'a_vista', data_base: s(det.data_base) || today,
    introducao: s(det.introducao), observacao: s(p.observacao), texto_legal: s(p.texto_legal),
    contato: s(p.contato), responsavel_id: s(p.responsavel_id), situacao: s(p.situacao) || 'em_aberto',
    itens: Array.isArray(det.itens) ? det.itens : [],
    parcelas: Array.isArray(det.parcelas) ? det.parcelas.map(pc => ({ vencimento: s(pc.vencimento), valor: num2br(pc.valor) })) : [],
  }

  return (
    <PropostaForm
      clientes={clientes}
      members={members}
      defaultResponsavelId={userId}
      today={today}
      redirectTo={`/${orgSlug}/producao/proposta`}
      initial={initial}
      submitLabel="Salvar"
      onSubmit={updateProducao.bind(null, orgSlug, producaoId)}
    />
  )
}
