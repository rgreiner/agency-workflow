import { notFound } from 'next/navigation'
import { updateMidia } from '@/app/actions/midia'
import { loadMidiaSelectors } from '@/lib/midia-selectors'
import { ExternaForm, type ExternaValues, type Localizacao } from '../ExternaForm'

function s(v: unknown): string { return v == null ? '' : String(v) }
function num2br(v: unknown): string {
  if (v == null || v === '') return ''
  const n = Number(v)
  return isNaN(n) ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default async function EditarExternaPage({
  params,
}: {
  params: Promise<{ orgSlug: string; midiaId: string }>
}) {
  const { orgSlug, midiaId } = await params
  const { supabase, clientes, veiculos, members, userId, today } = await loadMidiaSelectors(orgSlug)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: m } = await (supabase as any).from('midias').select('*').eq('id', midiaId).single()
  if (!m) notFound()

  const det = (m.detalhe ?? {}) as Record<string, unknown>

  const initial: ExternaValues = {
    workspace_id: s(m.workspace_id), campaign_id: s(m.campaign_id), veiculo_id: s(m.veiculo_id),
    titulo: s(m.titulo), emissao: s(m.emissao), job: s(m.job), aut_veiculo: s(m.aut_veiculo),
    codigo_identificador: s(m.codigo_identificador), nota_fiscal: s(m.nota_fiscal),
    mes: s(det.mes) || String(new Date().getMonth() + 1), ano: s(det.ano) || today.slice(0, 4),
    bisemana: s(det.bisemana) || 'outro', periodo: s(det.periodo),
    praca: s(m.praca), abrangencia: s(m.abrangencia) || 'estadual', especie: s(det.especie) || 'Outdoor',
    negociacao: s(det.negociacao) || 'custos_normais', producao_tipo: s(det.producao_tipo) || 'no_veiculo',
    pedido_producao: s(det.pedido_producao),
    producao_valor: s(det.producao_valor), producao_comissao_pct: s(det.producao_comissao_pct), producao_quantidade: s(det.producao_quantidade),
    custo: s(det.custo), desconto_exibicao: s(det.desconto_exibicao) || '0',
    desconto_pct: num2br(m.desconto_pct), faturamento: s(m.faturamento) || 'valor_bruto',
    prazo: s(m.prazo) || 'a_vista', data_base: s(m.data_base), dias_agencia: s(m.dias_agencia) || '7',
    primeira_veiculacao: s(m.primeira_veiculacao), ultima_veiculacao: s(m.ultima_veiculacao),
    contato: s(m.contato), responsavel_id: s(m.responsavel_id), situacao: s(m.situacao) || 'em_aberto',
    observacao: s(m.observacao), texto_legal: s(m.texto_legal),
    localizacoes: Array.isArray(det.localizacoes) ? (det.localizacoes as Localizacao[]) : [],
  }

  return (
    <ExternaForm
      clientes={clientes}
      veiculos={veiculos}
      members={members}
      defaultResponsavelId={userId}
      today={today}
      redirectTo={`/${orgSlug}/midias/externas`}
      initial={initial}
      submitLabel="Salvar"
      onSubmit={updateMidia.bind(null, orgSlug, midiaId)}
    />
  )
}
