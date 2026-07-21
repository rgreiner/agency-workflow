'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { parseMoney } from '@/lib/midia'

const FIELDS = [
  'tipo', 'workspace_id', 'campaign_id', 'titulo', 'faturar', 'emissao', 'validade_dias',
  'bv_pct', 'honorarios_pct', 'valor', 'codigo_identificador', 'nota_fiscal', 'situacao',
  'observacao', 'texto_legal', 'contato', 'responsavel_id',
] as const

function readData(formData: FormData) {
  const data: Record<string, string> = {}
  for (const f of FIELDS) data[f] = ((formData.get(f) as string) ?? '').trim()
  return data
}
function readDetalhe(formData: FormData): unknown {
  try { return JSON.parse((formData.get('detalhe') as string) || '{}') } catch { return {} }
}

export async function createProducao(orgSlug: string, formData: FormData) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const data = readData(formData)
  const redirectTo = ((formData.get('redirect_to') as string) ?? '').trim()
  if (!data.workspace_id) return { error: 'Cliente obrigatório' }
  if (!data.titulo) return { error: 'Título obrigatório' }

  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }

  const payload = { ...data, detalhe: readDetalhe(formData) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('create_producao', { p_user_id: user.id, p_org_id: org.id, p_data: payload })
  if (error) return { error: error.message }
  redirect(redirectTo || `/${orgSlug}/producao/orcamento`)
}

export async function updateProducao(orgSlug: string, producaoId: string, formData: FormData) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const data = readData(formData)
  const redirectTo = ((formData.get('redirect_to') as string) ?? '').trim()
  if (!data.titulo) return { error: 'Título obrigatório' }

  const payload = { ...data, detalhe: readDetalhe(formData) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('update_producao', { p_user_id: user.id, p_producao_id: producaoId, p_data: payload })
  if (error) return { error: error.message }
  const dest = redirectTo || `/${orgSlug}/producao/orcamento`
  revalidatePath(dest)
  redirect(dest)
}

/** Gera um Pedido de Produção por item (com opção escolhida) de um Orçamento aprovado. */
export async function gerarPedidosDoOrcamento(orgSlug: string, orcamentoId: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: orc } = await (supabase as any).from('producao').select('*').eq('id', orcamentoId).single()
  if (!orc || orc.tipo !== 'orcamento') return { error: 'Orçamento não encontrado' }

  // Idempotência: um orçamento gera PPs uma vez só. Antes nada impedia clicar duas
  // vezes — cada clique criava um conjunto novo de PPs duplicados, em silêncio.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: jaGerados } = await (supabase as any)
    .from('producao').select('id', { count: 'exact', head: true })
    .eq('origem_orcamento_id', orcamentoId)
  if ((jaGerados ?? 0) > 0) {
    return { error: `Este orçamento já gerou ${jaGerados} Pedido(s) de Produção. Exclua os PPs gerados antes de gerar de novo.` }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const itens: any[] = Array.isArray(orc.detalhe?.itens) ? orc.detalhe.itens : []
  let count = 0

  for (const it of itens) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opcoes: any[] = Array.isArray(it.opcoes) ? it.opcoes : []
    const sel = opcoes.find(o => o.selecionado) ?? opcoes[0]
    if (!sel || !sel.fornecedor_id) continue

    const quant = parseInt(sel.quant || '1', 10) || 1
    const valor = parseMoney(sel.valor_unit || '') * quant

    const payload = {
      tipo: 'pedido',
      workspace_id: orc.workspace_id,
      campaign_id: orc.campaign_id ?? '',
      titulo: `${orc.titulo}${it.nome ? ` - ${it.nome}` : ''}`,
      faturar: orc.faturar ?? 'contra_cliente',
      emissao: new Date().toISOString().slice(0, 10),
      bv_pct: String(orc.bv_pct ?? 15),
      honorarios_pct: String(orc.honorarios_pct ?? 0),
      valor: String(valor),
      situacao: 'em_aberto',
      // Coluna de verdade (migration 137). O detalhe.orcamento_id continua por
      // compatibilidade, mas é ele que o PedidoForm apaga ao salvar — quem manda é a coluna.
      origem_orcamento_id: orcamentoId,
      detalhe: {
        fornecedor_id: sel.fornecedor_id,
        entrega: '',
        prazo: 'a_vista',
        orcamento_id: orcamentoId,
        itens: [{ nome: it.nome ?? '', descricao: it.descricao ?? '', n_orc: sel.n_orc ?? '', quant: String(quant), valor: sel.valor_unit ?? '' }],
        parcelas: [],
      },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).rpc('create_producao', { p_user_id: user.id, p_org_id: org.id, p_data: payload })
    if (error) return { error: error.message }
    count++
  }

  if (count === 0) return { error: 'Nenhum item com opção/fornecedor escolhido neste orçamento.' }

  // Fim do ciclo: o orçamento virou produção. Sai da aba Ativos e fica consultável em
  // Arquivados, com o histórico intacto.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).rpc('concluir_orcamento', { p_user_id: user.id, p_orcamento_id: orcamentoId })

  revalidatePath(`/${orgSlug}/producao/orcamento`)
  revalidatePath(`/${orgSlug}/producao/pedido`)
  redirect(`/${orgSlug}/producao/pedido`)
}

/** Gera rascunhos (mídia/pedido/fee) a partir dos itens aprovados de uma Proposta. */
export async function gerarDocsDaProposta(orgSlug: string, propostaId: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: prop } = await (supabase as any).from('producao').select('*').eq('id', propostaId).single()
  if (!prop || prop.tipo !== 'proposta') return { error: 'Proposta não encontrada' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const itens: any[] = Array.isArray(prop.detalhe?.itens) ? prop.detalhe.itens : []
  const aprovados = itens.filter(it => it.situacao === 'aprovado')
  const target = aprovados.length ? aprovados : itens.filter(it => it.situacao !== 'cancelado')

  const today = new Date().toISOString().slice(0, 10)
  let count = 0, skipped = 0

  for (const it of target) {
    const quant = parseInt(it.quantidade || '1', 10) || 1
    const valor = parseMoney(it.valor_unit || '') * quant * (1 - parseMoney(it.desconto || '') / 100)
    const titulo = `${prop.titulo}${it.nome ? ` - ${it.nome}` : ''}`
    const baseScalar = { workspace_id: prop.workspace_id, campaign_id: prop.campaign_id ?? '', titulo, valor: String(valor), situacao: 'em_aberto', emissao: today }
    let res
    if (it.tipo === 'midia') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      res = await (supabase as any).rpc('create_midia', { p_user_id: user.id, p_org_id: org.id, p_data: { ...baseScalar, tipo: 'outros', desconto_pct: '0', faturamento: 'valor_bruto', prazo: 'a_vista', dias_agencia: '7' } })
    } else if (it.tipo === 'producao') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      res = await (supabase as any).rpc('create_producao', { p_user_id: user.id, p_org_id: org.id, p_data: { ...baseScalar, tipo: 'pedido', bv_pct: '15', detalhe: { fornecedor_id: '', entrega: '', prazo: 'a_vista', itens: [{ nome: it.nome ?? '', descricao: '', n_orc: '', quant: String(quant), valor: it.valor_unit ?? '' }], parcelas: [] } } })
    } else if (it.tipo === 'fee') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      res = await (supabase as any).rpc('create_producao', { p_user_id: user.id, p_org_id: org.id, p_data: { ...baseScalar, tipo: 'fee', detalhe: { de: '', ate: '', num_parcelas: '', valor_mensal: it.valor_unit ?? '', parcelas: [] } } })
    } else {
      skipped++; continue  // serviço interno (sem doc-destino)
    }
    if (res?.error) return { error: res.error.message }
    count++
  }

  if (count === 0) return { error: 'Nenhum item gerável (mídia/produção/fee) aprovado nesta proposta.' }

  revalidatePath(`/${orgSlug}/midias/simplificada`)
  revalidatePath(`/${orgSlug}/producao/pedido`)
  revalidatePath(`/${orgSlug}/producao/fee`)
  return { count, skipped }
}

export async function setProducaoSituacao(orgSlug: string, producaoId: string, situacao: string, basePath: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('set_producao_situacao', { p_user_id: user.id, p_producao_id: producaoId, p_situacao: situacao })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/${basePath}`)
}

export async function setProducaoArchived(orgSlug: string, producaoId: string, archived: boolean, basePath: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('set_producao_archived', { p_user_id: user.id, p_producao_id: producaoId, p_archived: archived })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/${basePath}`)
}
