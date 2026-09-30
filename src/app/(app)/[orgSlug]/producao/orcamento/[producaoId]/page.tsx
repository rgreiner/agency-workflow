import { notFound } from 'next/navigation'
import { updateProducao } from '@/app/actions/producao'
import { loadProducaoSelectors } from '@/lib/midia-selectors'
import { OrcamentoForm, type OrcamentoValues, type ItemOrc } from '../OrcamentoForm'
import type { CotacaoView, FornecedorCotacaoOpt } from '../CotacaoPainel'
import { urlCotacao } from '@/lib/cotacao'
import { telefoneNacional } from '@/lib/telefone'

type Contatos = { emails?: { email?: string }[] | null; telefones?: { numero?: string }[] | null }
const emailDe = (f: Contatos) => (f.emails ?? []).map(e => (e.email ?? '').trim()).find(e => e.includes('@')) ?? null
// Prefere o número que o WhatsApp acha (com DDD); celular antes de fixo.
const telefoneDe = (f: Contatos) => {
  const nums = (f.telefones ?? []).map(t => t.numero ?? '').filter(n => telefoneNacional(n))
  return nums.find(n => telefoneNacional(n)!.length === 11) ?? nums[0] ?? null
}

function s(v: unknown): string { return v == null ? '' : String(v) }
function num2br(v: unknown): string {
  if (v == null || v === '') return ''
  const n = Number(v)
  return isNaN(n) ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default async function EditarOrcamentoPage({
  params, searchParams,
}: {
  params: Promise<{ orgSlug: string; producaoId: string }>
  searchParams: Promise<{ cotacao?: string }>
}) {
  const { orgSlug, producaoId } = await params
  const { cotacao: abrirCotacao } = await searchParams
  const { supabase, clientes, fornecedores, members, userId, today } = await loadProducaoSelectors(orgSlug)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: p } = await (supabase as any).from('producao').select('*').eq('id', producaoId).single()
  if (!p) notFound()

  const det = (p.detalhe ?? {}) as { itens?: ItemOrc[] }

  // Pedido de cotação (mig. 310): rodadas deste orçamento + cadastro para escolher quem recebe.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const [{ data: cots }, { data: forns }, { data: org }] = await Promise.all([
    sb.from('cotacoes')
      .select('id, created_at, prazo_resposta, encerrada, mensagem, anexos, itens, convites:cotacao_convites(id, fornecedor_id, token, email_para, email_enviado_em, whatsapp_em, aberto_em, respondido_em, recusado_em, resposta, resposta_anexos, dados_fornecedor, fornecedor:fornecedor_id(name, telefones))')
      .eq('producao_id', producaoId).order('created_at', { ascending: false }),
    sb.from('fornecedores').select('id, name, tipo, tags, emails, telefones').eq('org_id', p.org_id).eq('archived', false).order('name'),
    sb.from('organizations').select('name').eq('id', p.org_id).single(),
  ])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cotacoes: CotacaoView[] = (cots ?? []).map((c: any) => ({
    id: c.id, created_at: c.created_at, prazo_resposta: c.prazo_resposta, encerrada: c.encerrada,
    mensagem: c.mensagem, anexos: c.anexos ?? [], itens: c.itens ?? [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    convites: (c.convites ?? []).map((v: any) => ({
      id: v.id, fornecedor_id: v.fornecedor_id, fornecedor: v.fornecedor?.name ?? '—', url: urlCotacao(v.token),
      email_para: v.email_para, telefone: telefoneDe(v.fornecedor ?? {}),
      email_enviado_em: v.email_enviado_em, whatsapp_em: v.whatsapp_em, aberto_em: v.aberto_em,
      respondido_em: v.respondido_em, recusado_em: v.recusado_em,
      resposta: v.resposta, resposta_anexos: v.resposta_anexos ?? [], dados_fornecedor: v.dados_fornecedor,
    })),
  }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fornecedoresCotacao: FornecedorCotacaoOpt[] = (forns ?? []).map((f: any) => ({
    id: f.id, name: f.name, tipo: f.tipo, tags: f.tags ?? [], email: emailDe(f), telefone: telefoneDe(f),
  }))

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
      cotacao={{ orcamentoId: producaoId, agencia: org?.name ?? '', cotacoes, fornecedores: fornecedoresCotacao, abrir: abrirCotacao === '1' }}
    />
  )
}
