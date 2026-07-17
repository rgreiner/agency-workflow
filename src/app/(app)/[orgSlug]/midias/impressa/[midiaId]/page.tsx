import { notFound } from 'next/navigation'
import { updateMidia } from '@/app/actions/midia'
import { loadMidiaSelectors } from '@/lib/midia-selectors'
import { midiaTextoLegalPadrao } from '@/lib/agency'
import { ImpressaForm, type ImpressaValues, type Insercao } from '../ImpressaForm'
import { JornalForm, type JornalValues } from '../JornalForm'
import { LockableFormShell } from '@/components/ui/LockableFormShell'

function s(v: unknown): string { return v == null ? '' : String(v) }
function num2br(v: unknown): string {
  if (v == null || v === '') return ''
  const n = Number(v)
  return isNaN(n) ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default async function EditarImpressaPage({
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

  const det = (m.detalhe ?? {}) as Record<string, unknown>
  const common = {
    clientes, veiculos, members,
    defaultResponsavelId: userId, today,
    redirectTo: `/${orgSlug}/midias/impressa`,
    submitLabel: 'Salvar',
    defaultTextoLegal,
    onSubmit: updateMidia.bind(null, orgSlug, midiaId),
  }

  if (m.tipo === 'impressa_jornal') {
    const initial: JornalValues = {
      workspace_id: s(m.workspace_id), campaign_id: s(m.campaign_id), veiculo_id: s(m.veiculo_id),
      titulo: s(m.titulo), emissao: s(m.emissao), job: s(m.job), aut_veiculo: s(m.aut_veiculo),
      codigo_identificador: s(m.codigo_identificador), nota_fiscal: s(m.nota_fiscal),
      secao: s(det.secao), tipo_anuncio: s(det.tipo_anuncio), determinacao: s(det.determinacao), em: s(det.em),
      colunas: s(det.colunas), cm: s(det.cm), mes: s(det.mes) || String(new Date().getMonth() + 1), ano: s(det.ano) || today.slice(0, 4),
      entregar_por: s(det.entregar_por), ja_publicado_em: s(det.ja_publicado_em), cores: s(det.cores), edicao: s(det.edicao),
      abrangencia: s(m.abrangencia) || 'estadual', observacao: s(m.observacao),
      negociacao: s(det.negociacao) || 'valor_fechado', valor: num2br(m.valor),
      desconto_pct: num2br(m.desconto_pct), faturamento: s(m.faturamento) || 'valor_bruto',
      prazo: s(m.prazo) || 'a_vista', data_base: s(m.data_base), dias_agencia: s(m.dias_agencia) || '7',
      primeira_veiculacao: s(m.primeira_veiculacao), ultima_veiculacao: s(m.ultima_veiculacao),
      contato: s(m.contato), responsavel_id: s(m.responsavel_id), situacao: s(m.situacao) || 'em_aberto',
      texto_legal: s(m.texto_legal),
      dias: (det.dias as Record<string, string>) ?? {},
    }
    return (
      <LockableFormShell initialLocked={['faturar', 'faturado'].includes(String(m.situacao ?? ''))}>
        <JornalForm {...common} initial={initial} />
      </LockableFormShell>
    )
  }

  const initial: ImpressaValues = {
    workspace_id: s(m.workspace_id), campaign_id: s(m.campaign_id), veiculo_id: s(m.veiculo_id),
    titulo: s(m.titulo), emissao: s(m.emissao), job: s(m.job), aut_veiculo: s(m.aut_veiculo),
    codigo_identificador: s(m.codigo_identificador), nota_fiscal: s(m.nota_fiscal),
    revista: s(det.revista), periodo: s(det.periodo),
    desconto_pct: num2br(m.desconto_pct), faturamento: s(m.faturamento) || 'valor_bruto',
    prazo: s(m.prazo) || 'a_vista', data_base: s(m.data_base), dias_agencia: s(m.dias_agencia) || '7',
    primeira_veiculacao: s(m.primeira_veiculacao), ultima_veiculacao: s(m.ultima_veiculacao),
    contato: s(m.contato), responsavel_id: s(m.responsavel_id), situacao: s(m.situacao) || 'em_aberto',
    observacao: s(m.observacao), texto_legal: s(m.texto_legal),
    insercoes: Array.isArray(det.insercoes) ? (det.insercoes as Insercao[]) : [],
  }
  return (
    <LockableFormShell initialLocked={['faturar', 'faturado'].includes(String(m.situacao ?? ''))}>
      <ImpressaForm {...common} initial={initial} />
    </LockableFormShell>
  )
}
