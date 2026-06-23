import { notFound } from 'next/navigation'
import { updateProducao } from '@/app/actions/producao'
import { loadProducaoSelectors } from '@/lib/midia-selectors'
import { PedidoForm, type PedidoValues, type ItemPed, type Parcela } from '../PedidoForm'

function s(v: unknown): string { return v == null ? '' : String(v) }
function num2br(v: unknown): string {
  if (v == null || v === '') return ''
  const n = Number(v)
  return isNaN(n) ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default async function EditarPedidoPage({
  params,
}: {
  params: Promise<{ orgSlug: string; producaoId: string }>
}) {
  const { orgSlug, producaoId } = await params
  const { supabase, clientes, fornecedores, members, userId, today } = await loadProducaoSelectors(orgSlug)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: p } = await (supabase as any).from('producao').select('*').eq('id', producaoId).single()
  if (!p) notFound()

  const det = (p.detalhe ?? {}) as { fornecedor_id?: string; entrega?: string; prazo?: string; itens?: ItemPed[]; parcelas?: Parcela[] }
  const parcelas: Parcela[] = Array.isArray(det.parcelas)
    ? det.parcelas.map(pc => ({ vencimento: s(pc.vencimento), valor: num2br(pc.valor), tipo: s(pc.tipo) || 'cliente_paga_fornecedor' }))
    : []

  const initial: PedidoValues = {
    workspace_id: s(p.workspace_id), campaign_id: s(p.campaign_id), fornecedor_id: s(det.fornecedor_id),
    titulo: s(p.titulo), emissao: s(p.emissao), entrega: s(det.entrega),
    codigo_identificador: s(p.codigo_identificador), nota_fiscal: s(p.nota_fiscal),
    faturar: s(p.faturar) || 'contra_cliente', bv_pct: num2br(p.bv_pct), honorarios_pct: num2br(p.honorarios_pct),
    prazo: s(det.prazo) || 'a_vista', contato: s(p.contato), responsavel_id: s(p.responsavel_id),
    situacao: s(p.situacao) || 'em_aberto', observacao: s(p.observacao), texto_legal: s(p.texto_legal),
    itens: Array.isArray(det.itens) ? det.itens : [],
    parcelas,
  }

  return (
    <PedidoForm
      clientes={clientes}
      fornecedores={fornecedores}
      members={members}
      defaultResponsavelId={userId}
      today={today}
      redirectTo={`/${orgSlug}/producao/pedido`}
      initial={initial}
      submitLabel="Salvar"
      onSubmit={updateProducao.bind(null, orgSlug, producaoId)}
    />
  )
}
