'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'

/** Faturamento → "Lançar": cria o lançamento de uma mídia conferida. */
/** Classificação escolhida na conferência do Faturamento (grava no lançamento). */
export interface FaturarClassificacao {
  conta_id?: string | null
  categoria?: string | null
  centro_custo?: string | null
  forma_pagamento?: string | null
}

export async function lancarMidia(orgSlug: string, midiaId: string, cls?: FaturarClassificacao) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('lancar_midia', {
    p_user_id: user.id, p_midia_id: midiaId,
    p_conta_id: cls?.conta_id || null, p_categoria: cls?.categoria || null,
    p_centro_custo: cls?.centro_custo || null, p_forma: cls?.forma_pagamento || null,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/faturamento`)
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
}

/** "Atualizar do documento": edita o mesmo lançamento com os valores atuais da mídia. */
export async function ressincronizarLancamento(orgSlug: string, lancamentoId: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('ressincronizar_lancamento', {
    p_user_id: user.id, p_lancamento_id: lancamentoId,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
}

/** Baixa o flag de "revisar" sem alterar valores. */
export async function marcarLancamentoRevisado(orgSlug: string, lancamentoId: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('marcar_lancamento_revisado', {
    p_user_id: user.id, p_lancamento_id: lancamentoId,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
}

export async function setLancamentoFlags(orgSlug: string, lancamentoId: string, nf: boolean, boleto: boolean) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('set_lancamento_flags', {
    p_user_id: user.id, p_lancamento_id: lancamentoId, p_nf: nf, p_boleto: boleto,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
}

/**
 * Centro de custo é OBRIGATÓRIO (decisão do Rafael 31/07/2026): é ele que diz de
 * qual cliente veio (ou sai) o dinheiro — sem ele a rentabilidade por cliente
 * fica cega. Transferência entre contas é isenta (zero-soma, não é venda nem
 * despesa). O caminho da conciliação bancária (criarLancamentoConc) fica de fora
 * de propósito: lá o lançamento nasce do movimento e o filtro "sem centro" da
 * tela cobra a classificação depois.
 */
function faltaCentro(data: { centro_custo?: string | null; categoria?: string | null }): boolean {
  if ((data.centro_custo ?? '').trim()) return false
  return !(data.categoria ?? '').toLowerCase().startsWith('transfer')
}
const ERRO_CENTRO = 'Informe o centro de custo — ele diz de qual cliente vem (ou sai) o dinheiro.'

// ── Lançamento manual ────────────────────────────────────────
export interface LancamentoInput {
  tipo?: string
  contato_tipo?: string | null
  contato_nome?: string | null
  descricao?: string | null
  valor?: string
  vencimento?: string | null
  competencia?: string | null
  conta_id?: string | null
  categoria?: string | null
  centro_custo?: string | null
  forma_pagamento?: string | null
  observacao?: string | null
  recorrente?: boolean
  anexos?: Anexo[]
}

/**
 * Promove uma linha do extrato importado (Conta Azul) para um lançamento editável do
 * Flow. Guarda import_ref em origem_ref p/ a tela esconder a linha importada (não
 * duplica após reimport). Recebe os campos editáveis + os de liquidação do snapshot.
 */
export interface PromoverInput extends LancamentoInput {
  situacao?: string | null
  data_liquidacao?: string | null
  valor_realizado?: string | null
  juros?: string | null; multa?: string | null; desconto?: string | null; tarifa?: string | null
}
export async function promoverExtrato(orgSlug: string, importRef: string, data: PromoverInput) {
  if (faltaCentro(data)) return { error: ERRO_CENTRO }
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('promover_extrato', {
    p_user_id: user.id, p_org_id: org.id, p_import_ref: importRef, p_dados: data,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
}

export async function createLancamento(orgSlug: string, data: LancamentoInput) {
  if (faltaCentro(data)) return { error: ERRO_CENTRO }
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('create_lancamento', {
    p_user_id: user.id, p_org_id: org.id, p_data: data,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
}

export interface TransferenciaInput {
  conta_origem_id: string
  conta_destino_id: string
  valor: string | number
  data: string
  descricao?: string | null
}

/** Cria uma transferência entre contas = 2 lançamentos ligados (saída origem + entrada destino). */
export async function criarTransferencia(orgSlug: string, data: TransferenciaInput) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('criar_transferencia', {
    p_user_id: user.id, p_org_id: org.id, p_data: data,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
}

/** Exclui os DOIS lados de uma transferência de uma vez. Bloqueia se algum lado estiver
 *  conciliado com o extrato (a RPC devolve o erro pedindo desfazer a conciliação antes). */
export async function excluirTransferencia(orgSlug: string, transferenciaId: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('excluir_transferencia', {
    p_user_id: user.id, p_transferencia_id: transferenciaId,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
}

/** Cria uma série: modo 'parcelado' (divide o valor) ou 'recorrente' (repete) em N meses. */
export async function createLancamentosSerie(orgSlug: string, data: LancamentoInput, modo: string, n: number) {
  if (faltaCentro(data)) return { error: ERRO_CENTRO }
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('create_lancamentos_serie', {
    p_user_id: user.id, p_org_id: org.id, p_data: data, p_modo: modo, p_n: n,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
}

export async function updateLancamento(orgSlug: string, lancamentoId: string, data: LancamentoInput) {
  if (faltaCentro(data)) return { error: ERRO_CENTRO }
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('update_lancamento', {
    p_user_id: user.id, p_lancamento_id: lancamentoId, p_data: data,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
}

export interface ImpactoExclusao {
  pode: boolean
  motivo?: string
  /** 'documento' = estorna o faturamento inteiro; 'lancamento' = só esta linha. */
  escopo?: 'documento' | 'lancamento'
  origem?: string | null
  doc_serie?: string | null
  doc_numero?: number | null
  parcelas?: number
  valor_total?: number | string
}

/**
 * Prévia do que a exclusão vai causar — o modal de confirmação precisa dizer o
 * impacto real (quantas parcelas somem, qual documento volta pro Faturamento) e não
 * um texto genérico. Calculado no servidor porque a trava também mora lá.
 */
export async function impactoExcluirLancamento(lancamentoId: string): Promise<ImpactoExclusao> {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { pode: false, motivo: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('impacto_excluir_lancamento', {
    p_user_id: user.id, p_lancamento_id: lancamentoId,
  })
  if (error) return { pode: false, motivo: error.message }
  return data as ImpactoExclusao
}

export async function deleteLancamento(orgSlug: string, lancamentoId: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('delete_lancamento', {
    p_user_id: user.id, p_lancamento_id: lancamentoId,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
  // Estorno devolve o documento pro Faturamento — aquela tela também muda.
  revalidatePath(`/${orgSlug}/financeiro/faturamento`)
  return { ok: true, escopo: (data as { escopo?: string })?.escopo ?? 'lancamento' }
}

export interface BaixaInput {
  data_liquidacao?: string | null
  conta_id?: string | null
  forma_pagamento?: string | null
  valor_realizado?: string | null
  juros?: string
  multa?: string
  desconto?: string
  tarifa?: string
}

export async function liquidarLancamento(orgSlug: string, lancamentoId: string, data: BaixaInput) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('liquidar_lancamento', {
    p_user_id: user.id, p_lancamento_id: lancamentoId, p_data: data,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
}

/** Documento do lançamento. `url`/`nome` vazios = número registrado antes do arquivo
 *  chegar (a NF do fornecedor costuma ser anunciada por e-mail dias antes do PDF).
 *  Campos novos são opcionais: os ~101 anexos antigos continuam válidos como estão. */
export interface Anexo {
  url: string
  nome: string
  tipo: string
  numero?: string
  emitente?: string   // agencia | fornecedor | cliente
}

export async function setLancamentoAnexos(orgSlug: string, lancamentoId: string, anexos: Anexo[]) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('set_lancamento_anexos', {
    p_user_id: user.id, p_lancamento_id: lancamentoId, p_anexos: anexos,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
}

// Anexos recolhidos na conferência do Faturamento ficam no doc de origem e são
// copiados pro lançamento na geração (ver migration 102).
export async function setMidiaAnexos(orgSlug: string, midiaId: string, anexos: Anexo[]) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('set_midia_anexos', {
    p_user_id: user.id, p_midia_id: midiaId, p_anexos: anexos,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/faturamento`)
}

export async function setProducaoAnexos(orgSlug: string, producaoId: string, anexos: Anexo[]) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('set_producao_anexos', {
    p_user_id: user.id, p_producao_id: producaoId, p_anexos: anexos,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/faturamento`)
}

// ── Importar guia (Darf/FGTS/DAS/GPS/parcelamento) ───────────
/** Lançamento candidato a receber a guia — em aberto, no mês do vencimento dela. */
export interface GuiaCandidato {
  id: string
  descricao: string | null
  categoria: string | null
  centro_custo: string | null
  contato_nome: string | null
  valor: number
  vencimento: string | null
  conta_id: string | null
  origem_tipo: string | null
}

/** Palavras que identificam cada tipo de guia no lançamento (regex com \b: "das"
 *  não pode casar "Manutenção das Salas"). */
const GUIA_PADROES: Record<string, RegExp[]> = {
  darf: [/\bdarf\b/i, /\bdctf\w*\b/i, /\binss\b/i, /\birrf\b/i],
  fgts: [/\bfgts\b/i],
  das: [/\bdas\b/i, /\bsimples\b/i],
  gps: [/\bgps\b/i, /\binss\b/i, /\bprevid/i],
  parcelamento: [/\bparcelamento\b/i, /\bparcela\b/i],
  outro: [],
}

/** Busca lançamentos em aberto que combinam com a guia extraída (match e ranking
 *  em JS — controle fino de word boundary que o ilike não dá). Top 3. */
export async function buscarCandidatosGuia(orgSlug: string, g: {
  tipo: string; vencimento: string | null; competencia: string | null
  valor: number | null; palavras_chave?: string[]
}) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }

  // Janela: o mês do vencimento da guia (sem venc: mês seguinte à competência).
  const base = g.vencimento ?? (g.competencia ? `${g.competencia}-01` : null)
  if (!base) return { candidatos: [] as GuiaCandidato[] }
  const d = new Date(`${base.slice(0, 10)}T00:00:00Z`)
  if (!g.vencimento) d.setUTCMonth(d.getUTCMonth() + 1)
  const y = d.getUTCFullYear(); const m = d.getUTCMonth()
  const ini = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
  const fim = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = await (supabase as any)
    .from('lancamentos')
    .select('id, descricao, categoria, centro_custo, contato_nome, valor, vencimento, conta_id, origem_tipo')
    .eq('org_id', org.id).eq('tipo', 'saida').eq('situacao', 'em_aberto')
    .gte('vencimento', ini).lte('vencimento', fim)
    .limit(300)
  const lista = (rows ?? []) as (Omit<GuiaCandidato, 'valor'> & { valor: number | string })[]

  const padroes = [
    ...(GUIA_PADROES[g.tipo] ?? []),
    ...(g.palavras_chave ?? []).map(p => new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '')}\\b`, 'i')),
  ]
  const ehParcela = (t: string) => /\bparcelamento\b/i.test(t) || /\bparcela\b/i.test(t)
  const diaGuia = g.vencimento ? Number(g.vencimento.slice(8, 10)) : 20

  const pontuados: { l: GuiaCandidato; score: number }[] = []
  for (const l of lista) {
    const texto = `${l.categoria ?? ''} ${l.descricao ?? ''} ${l.contato_nome ?? ''}`
    // Guia comum nunca casa parcelamento (e vice-versa) — venc no mesmo mês confunde.
    if (g.tipo !== 'parcelamento' && ehParcela(texto)) continue
    if (g.tipo === 'parcelamento' && !ehParcela(texto)) continue
    const valor = Number(l.valor ?? 0)
    const hits = padroes.filter(p => p.test(texto)).length
    const valorIgual = g.valor != null && Math.abs(valor - g.valor) < 0.005
    if (hits === 0 && !valorIgual) continue
    const distDia = l.vencimento ? Math.abs(Number(l.vencimento.slice(8, 10)) - diaGuia) : 31
    const distValor = g.valor != null ? Math.abs(valor - g.valor) : 0
    pontuados.push({ l: { ...l, valor }, score: hits * 1000 - distDia * 10 - Math.min(distValor / 100, 9) })
  }
  pontuados.sort((a, b) => b.score - a.score)

  return { candidatos: pontuados.slice(0, 3).map(x => x.l) }
}

/** Aplica a guia num lançamento em aberto: valor real, vencimento, competência e
 *  o PDF anexado (RPC fin_aplicar_guia — recusa se já estiver pago). */
export async function aplicarGuiaLancamento(orgSlug: string, i: {
  lancamentoId: string; valor: number; vencimento: string | null
  competencia: string | null; anexo: Anexo | null
}) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('fin_aplicar_guia', {
    p_org_id: org.id, p_lancamento_id: i.lancamentoId,
    p_valor: i.valor, p_venc: i.vencimento,
    p_competencia: i.competencia ? `${i.competencia}-01` : null,
    p_anexo: i.anexo,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
}

export async function reabrirLancamento(orgSlug: string, lancamentoId: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('reabrir_lancamento', {
    p_user_id: user.id, p_lancamento_id: lancamentoId,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
}

// ── Contas financeiras ───────────────────────────────────────
export interface ContaInput {
  nome: string
  tipo: string
  saldo_inicial: string
  cor: string | null
  ativo: boolean
  ordem?: number
  /** Só para tipo 'cartao' (migration 191). Vazio = não é cartão / não mexe. */
  fechamento_dia?: string
  vencimento_dia?: string
  limite?: string
}

/**
 * Paga a fatura do cartão: liquida as compras do ciclo e move o dinheiro do banco
 * pro cartão numa transferência (zero-soma). É o único ponto em que N compras
 * viram uma saída de caixa só.
 */
export async function pagarFaturaCartao(
  orgSlug: string, contaId: string, vence: string, contaPagamentoId: string, data: string,
) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: res, error } = await (supabase as any).rpc('pagar_fatura_cartao', {
    p_user_id: user.id, p_conta_id: contaId, p_vence: vence,
    p_conta_pagamento_id: contaPagamentoId, p_data: data,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/contas`)
  revalidatePath(`/${orgSlug}/financeiro/contas/${contaId}`)
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
  return { result: res as { compras: number; total: number } }
}

export async function createConta(orgSlug: string, data: ContaInput) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  if (!data.nome.trim()) return { error: 'Nome obrigatório' }

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('create_conta_financeira', {
    p_user_id: user.id, p_org_id: org.id, p_data: data,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/contas`)
}

export async function updateConta(orgSlug: string, contaId: string, data: Partial<ContaInput>) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('update_conta_financeira', {
    p_user_id: user.id, p_conta_id: contaId, p_data: data,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/contas`)
}

/** Marca/desmarca a conta favorita (a favorita é a conta a receber padrão do Faturamento). */
export async function setContaFavorita(orgSlug: string, contaId: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('set_conta_favorita', {
    p_user_id: user.id, p_conta_id: contaId,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/contas`)
  revalidatePath(`/${orgSlug}/financeiro/faturamento`)
}

// ── Import do extrato (Conta Azul) ───────────────────────────
import type { ExtratoRow } from '@/lib/extrato'

/** Importa um lote de linhas do extrato (chamado em chunks pelo client). */
export async function importarExtrato(orgSlug: string, rows: ExtratoRow[]) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('import_extrato', {
    p_user_id: user.id, p_org_id: org.id, p_rows: rows,
  })
  if (error) return { error: error.message }
  return { result: data as { inserted: number; updated: number; total: number } }
}

/**
 * Semeia contas (com saldo atual), centros de custo e categorias a partir do extrato
 * JÁ importado (extrato_importado). Não-destrutivo: só adiciona o que falta e preenche
 * saldo de conta que esteja zerada. Pode rodar a qualquer momento.
 */
export async function seedFinanceFromExtrato(orgSlug: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('seed_finance_from_extrato_table', {
    p_user_id: user.id, p_org_id: org.id,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/contas`)
  revalidatePath(`/${orgSlug}/financeiro/categorias`)
  return { result: data as { contas: number; contas_atualizadas: number; centros: number; categorias: number } }
}

/** Promove os previstos do Conta Azul (Em aberto/Atrasado) a lançamentos em aberto — viram candidatos da conciliação. */
export async function promoverPrevistosExtrato(orgSlug: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('promover_extrato_previstos', {
    p_user_id: user.id, p_org_id: org.id,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
  revalidatePath(`/${orgSlug}/financeiro/conciliacao`)
  return { result: data as { inserted: number } }
}

/** Apaga todo o extrato importado da org. */
export async function limparExtrato(orgSlug: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('clear_extrato', {
    p_user_id: user.id, p_org_id: org.id,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/importar`)
}

// ── Config: categorias / centros de custo ────────────────────
// Categorias em árvore de 2 níveis (grupo → filhos), separadas por tipo
// (entrada = receita | saida = despesa). Um grupo sem filhos é uma categoria
// avulsa, selecionável diretamente.
export interface FinanceCategoriaFilho { nome: string; cor: string | null }
export interface FinanceCategoriaGrupo {
  nome: string
  tipo: string
  cor: string | null
  filhos: FinanceCategoriaFilho[]
}
export interface FinanceCentro { nome: string; cor: string | null; arquivado?: boolean }

export async function setFinanceConfig(orgSlug: string, categorias: FinanceCategoriaGrupo[], centros: FinanceCentro[]) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('set_finance_config', {
    p_user_id: user.id, p_org_id: org.id, p_categorias: categorias, p_centros: centros,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/categorias`)
}

/**
 * Edição em lote (barra flutuante em Lançamentos). Só campos que fazem sentido em
 * lote — vencimento/valor/contato ficam de fora, são únicos por linha.
 * A RPC PULA os conciliados (pago/recebido ou com baixa parcial) e devolve a
 * contagem, pra tela dizer o que foi feito em vez de falhar o lote inteiro.
 */
export async function updateLancamentosLote(
  orgSlug: string, ids: string[], data: Record<string, unknown>,
) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  if (!ids.length) return { error: 'Nenhum lançamento selecionado' }
  // O lote era o caminho que furava a obrigatoriedade do centro de custo: mandar
  // 'centro_custo' vazio apagava o centro de N lançamentos de uma vez, coisa que
  // o formulário nunca deixou fazer. (A RPC também ignora vazio, migration 187.)
  if ('centro_custo' in data && !String(data.centro_custo ?? '').trim()) {
    return { error: 'O centro de custo não pode ser apagado em lote — escolha um, ou desmarque o campo.' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: res, error } = await (supabase as any).rpc('update_lancamentos_lote', {
    p_user_id: user.id, p_ids: ids, p_data: data,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
  return { result: res as { atualizados: number; bloqueados: number; total: number } }
}

/**
 * Descarta uma linha do extrato importado de forma DURÁVEL. Marcar
 * situacao='Perdido/Desconsiderado' não resolve: o import da Conta Azul apaga e
 * recarrega o arquivo inteiro, e a linha volta. O descarte vive fora do extrato,
 * numa lista por import_ref (migration 132).
 */
export async function descartarExtrato(orgSlug: string, importRef: string, motivo?: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('descartar_extrato', {
    p_user_id: user.id, p_org_id: org.id, p_import_ref: importRef, p_motivo: motivo ?? null,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
  revalidatePath(`/${orgSlug}/financeiro/inadimplentes`)
}

// ── Envio do faturamento por e-mail ao cliente (não automático) ─────────────────
import { sendMail, remetenteDominio } from '@/lib/email/send'
import { htmlFaturamento, lerAnexosFaturamento } from '@/lib/email/faturamento'
import { docNumero } from '@/lib/doc-series'

const RECEBER_TIPOS_EMAIL = ['receber_bv', 'receber_honorarios', 'receber_cliente']

/**
 * Dispara o e-mail de faturamento ao cliente com os documentos anexados
 * (NF/Boleto/comprovantes). Só quando o financeiro escolhe "Faturar e enviar" —
 * nunca automático. From fixo da agência (financeiro@<domínio verificado>),
 * Reply-To de quem enviou, CC pra contabilidade. Registra o envio.
 */
export async function enviarFaturamentoEmail(
  orgSlug: string, tipo: 'midia' | 'producao', docId: string, destinatario: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const dest = destinatario.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dest)) {
    return { error: 'E-mail do cliente inválido — confira o destinatário.' }
  }

  const { data: org } = await supabase.from('organizations').select('id, name').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }

  // Documento + cliente.
  const tabela = tipo === 'midia' ? 'midias' : 'producao'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: doc } = await (supabase as any)
    .from(tabela)
    .select('id, serie, numero, titulo, valor, detalhe, anexos, workspaces(name)')
    .eq('id', docId).single()
  if (!doc) return { error: 'Documento não encontrado' }

  const numero = docNumero(doc.serie, doc.numero)
  const valorTotal = Number(doc.valor ?? 0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const todas = (Array.isArray(doc.detalhe?.parcelas) ? doc.detalhe.parcelas : []) as any[]
  const doCliente = todas.filter(p => RECEBER_TIPOS_EMAIL.includes(p?.tipo))
  const parcelas = (doCliente.length ? doCliente : []).map(p => ({
    vencimento: (p?.vencimento as string) ?? null,
    valor: Number(p?.valor ?? 0),
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anexosDoc = (Array.isArray(doc.anexos) ? doc.anexos : []) as any[]
  const attachments = await lerAnexosFaturamento(anexosDoc)

  // Remetente fixo da agência no domínio verificado; CC pra contabilidade.
  const dominio = remetenteDominio()
  const from = dominio ? `${org.name} Financeiro <financeiro@${dominio}>` : undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: cfg } = await (supabase as any).from('org_settings').select('contabil_emails').eq('org_id', org.id).maybeSingle()
  const cc = ((cfg?.contabil_emails ?? []) as string[]).filter(Boolean)

  const html = htmlFaturamento({
    orgName: org.name,
    clienteNome: doc.workspaces?.name ?? 'Cliente',
    docNumero: numero,
    titulo: doc.titulo || 'Faturamento',
    valorTotal,
    parcelas,
    anexosNomes: attachments.map(a => a.filename),
  })

  const { error } = await sendMail({
    to: dest,
    from,
    replyTo: user.email || undefined,
    cc: cc.length ? cc : undefined,
    subject: `Faturamento ${numero} — ${org.name}`,
    html,
    attachments,
  })
  if (error) return { error: `Faturado, mas o e-mail falhou: ${error}` }

  // Registra o envio (rastro).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).rpc('registrar_faturamento_envio', {
    p_user_id: user.id, p_org: org.id, p_tipo: tipo, p_doc_id: docId,
    p_doc_numero: numero, p_destinatario: dest, p_cc: cc,
  })

  revalidatePath(`/${orgSlug}/financeiro/faturamento`)
  return {}
}
