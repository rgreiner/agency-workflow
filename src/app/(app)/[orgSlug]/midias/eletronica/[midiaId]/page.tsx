import { notFound } from 'next/navigation'
import { updateMidia } from '@/app/actions/midia'
import { loadMidiaSelectors } from '@/lib/midia-selectors'
import { midiaTextoLegalPadrao } from '@/lib/agency'
import { EletronicaForm, type EletronicaValues, type PecaEl, type Periodo } from '../EletronicaForm'
import { LockableFormShell } from '@/components/ui/LockableFormShell'

function s(v: unknown): string { return v == null ? '' : String(v) }
function num2br(v: unknown): string {
  if (v == null || v === '') return ''
  const n = Number(v)
  return isNaN(n) ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default async function EditarEletronicaPage({
  params,
}: {
  params: Promise<{ orgSlug: string; midiaId: string }>
}) {
  const { orgSlug, midiaId } = await params
  const { supabase, orgId, clientes, veiculos, members, userId, today } = await loadMidiaSelectors(orgSlug)
  const defaultTextoLegal = await midiaTextoLegalPadrao(supabase, orgId)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: m } = await (supabase as any).from('midias').select('*').eq('id', midiaId).single()
  if (!m) notFound()

  const det = (m.detalhe ?? {}) as { pecas?: PecaEl[]; periodos?: Periodo[] }

  const initial: EletronicaValues = {
    workspace_id: s(m.workspace_id), campaign_id: s(m.campaign_id), veiculo_id: s(m.veiculo_id),
    titulo: s(m.titulo), emissao: s(m.emissao), job: s(m.job), aut_veiculo: s(m.aut_veiculo),
    codigo_identificador: s(m.codigo_identificador), nota_fiscal: s(m.nota_fiscal),
    praca: s(m.praca), abrangencia: s(m.abrangencia) || 'estadual',
    desconto_pct: num2br(m.desconto_pct), faturamento: s(m.faturamento) || 'valor_bruto',
    prazo: s(m.prazo) || 'a_vista', data_base: s(m.data_base), dias_agencia: s(m.dias_agencia) || '7',
    primeira_veiculacao: s(m.primeira_veiculacao), ultima_veiculacao: s(m.ultima_veiculacao),
    contato: s(m.contato), responsavel_id: s(m.responsavel_id), situacao: s(m.situacao) || 'em_aberto',
    observacao: s(m.observacao), texto_legal: s(m.texto_legal),
    pecas: Array.isArray(det.pecas) ? det.pecas : [],
    periodos: Array.isArray(det.periodos) ? det.periodos : [],
  }

  return (
    <LockableFormShell initialLocked={['faturar', 'faturado'].includes(String(m.situacao ?? ''))}>
      <EletronicaForm
        clientes={clientes}
        veiculos={veiculos}
        members={members}
        defaultResponsavelId={userId}
        today={today}
        redirectTo={`/${orgSlug}/midias/eletronica`}
        initial={initial}
        submitLabel="Salvar"
        defaultTextoLegal={defaultTextoLegal}
        onSubmit={updateMidia.bind(null, orgSlug, midiaId)}
      />
    </LockableFormShell>
  )
}
