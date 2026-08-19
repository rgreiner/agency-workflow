import { notFound } from 'next/navigation'
import { updateProducao } from '@/app/actions/producao'
import { loadProducaoSelectors } from '@/lib/midia-selectors'
import { VendaForm, type VendaValues } from '../VendaForm'
import { LockableFormShell } from '@/components/ui/LockableFormShell'

function s(v: unknown): string { return v == null ? '' : String(v) }
function num2br(v: unknown): string {
  if (v == null || v === '') return ''
  const n = Number(v)
  return isNaN(n) ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
/** Percentual não leva separador de milhar — 12.5 vira "12,5", não "12,50". */
function pct2br(v: unknown): string {
  if (v == null || v === '') return ''
  const n = Number(v)
  return isNaN(n) || n === 0 ? '' : String(n).replace('.', ',')
}

export default async function EditarVendaPage({
  params,
}: {
  params: Promise<{ orgSlug: string; producaoId: string }>
}) {
  const { orgSlug, producaoId } = await params
  const { supabase, clientes, members, userId, today } = await loadProducaoSelectors(orgSlug)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: p } = await (supabase as any).from('producao').select('*').eq('id', producaoId).single()
  if (!p) notFound()

  const det = (p.detalhe ?? {}) as {
    mes_venda?: string; venda_base?: string; comissao_pct?: string
    parcelas?: { vencimento?: string; valor?: string }[]
  }
  const parcela = Array.isArray(det.parcelas) ? det.parcelas[0] : undefined

  const initial: VendaValues = {
    workspace_id: s(p.workspace_id),
    titulo: s(p.titulo),
    // Documento antigo sem `mes_venda` cai no mês da emissão — melhor que campo vazio.
    mes_venda: s(det.mes_venda) || s(p.emissao).slice(0, 7) || today.slice(0, 7),
    vencimento: s(parcela?.vencimento),
    venda_base: num2br(det.venda_base ?? p.valor),
    comissao_pct: pct2br(det.comissao_pct ?? p.bv_pct),
    comissao: num2br(parcela?.valor),
    emissao: s(p.emissao) || today,
    responsavel_id: s(p.responsavel_id) || userId,
    situacao: s(p.situacao) || 'em_aberto',
    observacao: s(p.observacao),
  }

  return (
    <LockableFormShell initialLocked={['faturar', 'faturado'].includes(String(p.situacao ?? ''))}>
      <VendaForm
        clientes={clientes}
        members={members}
        defaultResponsavelId={userId}
        today={today}
        redirectTo={`/${orgSlug}/producao/venda`}
        initial={initial}
        submitLabel="Salvar"
        onSubmit={updateProducao.bind(null, orgSlug, producaoId)}
      />
    </LockableFormShell>
  )
}
