'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'

/** Regera os lançamentos de comissão das mídias faturadas (botão "Gerar Lançamentos"). */
export async function regerarLancamentos(orgSlug: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('regerar_lancamentos_midias', {
    p_user_id: user.id, p_org_id: org.id,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/faturamento`)
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
}

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

export async function setLancamentoSituacao(orgSlug: string, lancamentoId: string, situacao: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('set_lancamento_situacao', {
    p_user_id: user.id, p_lancamento_id: lancamentoId, p_situacao: situacao,
  })
  if (error) return { error: error.message }
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

/** Cria uma série: modo 'parcelado' (divide o valor) ou 'recorrente' (repete) em N meses. */
export async function createLancamentosSerie(orgSlug: string, data: LancamentoInput, modo: string, n: number) {
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
