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
export async function lancarMidia(orgSlug: string, midiaId: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('lancar_midia', {
    p_user_id: user.id, p_midia_id: midiaId,
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

export async function deleteLancamento(orgSlug: string, lancamentoId: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('delete_lancamento', {
    p_user_id: user.id, p_lancamento_id: lancamentoId,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
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

export interface Anexo { url: string; nome: string; tipo: string }

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
export interface FinanceCentro { nome: string; cor: string | null }

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
