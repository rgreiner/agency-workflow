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
export interface FinanceCategoria { nome: string; tipo: string; cor: string | null }
export interface FinanceCentro { nome: string; cor: string | null }

export async function setFinanceConfig(orgSlug: string, categorias: FinanceCategoria[], centros: FinanceCentro[]) {
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
