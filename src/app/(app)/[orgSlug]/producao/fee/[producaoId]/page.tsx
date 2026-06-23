import { notFound } from 'next/navigation'
import { updateProducao } from '@/app/actions/producao'
import { loadProducaoSelectors } from '@/lib/midia-selectors'
import { FeeForm, type FeeValues, type ParcelaFee } from '../FeeForm'

function s(v: unknown): string { return v == null ? '' : String(v) }
function num2br(v: unknown): string {
  if (v == null || v === '') return ''
  const n = Number(v)
  return isNaN(n) ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default async function EditarFeePage({
  params,
}: {
  params: Promise<{ orgSlug: string; producaoId: string }>
}) {
  const { orgSlug, producaoId } = await params
  const { supabase, clientes, members, userId, today } = await loadProducaoSelectors(orgSlug)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: p } = await (supabase as any).from('producao').select('*').eq('id', producaoId).single()
  if (!p) notFound()

  const det = (p.detalhe ?? {}) as { de?: string; ate?: string; num_parcelas?: string; valor_mensal?: string; parcelas?: ParcelaFee[] }
  const parcelas: ParcelaFee[] = Array.isArray(det.parcelas)
    ? det.parcelas.map(pc => ({ vencimento: s(pc.vencimento), valor: num2br(pc.valor), tipo: 'receber_cliente' }))
    : []

  const initial: FeeValues = {
    workspace_id: s(p.workspace_id), titulo: s(p.titulo),
    de: s(det.de), ate: s(det.ate), num_parcelas: s(det.num_parcelas) || '12', valor_mensal: s(det.valor_mensal),
    contato: s(p.contato), responsavel_id: s(p.responsavel_id), situacao: s(p.situacao) || 'em_aberto',
    observacao: s(p.observacao), texto_legal: s(p.texto_legal), parcelas,
  }

  return (
    <FeeForm
      clientes={clientes}
      members={members}
      defaultResponsavelId={userId}
      today={today}
      redirectTo={`/${orgSlug}/producao/fee`}
      initial={initial}
      submitLabel="Salvar"
      onSubmit={updateProducao.bind(null, orgSlug, producaoId)}
    />
  )
}
