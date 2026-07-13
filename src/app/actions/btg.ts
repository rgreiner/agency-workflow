'use server'

import { revalidatePath } from 'next/cache'
import { assertFinanceAccess } from '@/lib/finance'
import { syncOrgMovements } from '@/lib/btg/sync'
import { markBtgSynced, markBtgError, deleteBtgConnection } from '@/lib/btg/store'

export async function disconnectBtg(orgSlug: string) {
  const { orgId } = await assertFinanceAccess(orgSlug)
  await deleteBtgConnection(orgId)
  revalidatePath(`/${orgSlug}/financeiro/contas`)
}

/**
 * Testa a conexão ponta a ponta e já sincroniza os movimentos (30 dias): renova o
 * token, lista contas, puxa o extrato e faz upsert em btg_movements.
 */
export async function testBtg(orgSlug: string) {
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  try {
    const r = await syncOrgMovements(supabase, orgId)
    await markBtgSynced(orgId)
    revalidatePath(`/${orgSlug}/financeiro/contas`)
    revalidatePath(`/${orgSlug}/financeiro/conciliacao`)
    return { ok: true as const, ...r }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao consultar o BTG.'
    await markBtgError(orgId, msg)
    revalidatePath(`/${orgSlug}/financeiro/contas`)
    return { ok: false as const, error: msg }
  }
}

/** "Sincronizar agora" na tela de Conciliação — mesma lógica do testBtg. */
export async function sincronizarBtg(orgSlug: string) {
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  try {
    const r = await syncOrgMovements(supabase, orgId)
    await markBtgSynced(orgId)
    revalidatePath(`/${orgSlug}/financeiro/conciliacao`)
    return { ok: true as const, ...r }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao consultar o BTG.'
    await markBtgError(orgId, msg)
    return { ok: false as const, error: msg }
  }
}

/** Liga o movimento do banco a um lançamento e dá baixa nele (recebido/pago). */
export async function conciliarMovimento(orgSlug: string, movementId: string, lancamentoId: string) {
  const { supabase, userId } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('conciliar_btg_movimento', {
    p_user_id: userId, p_movement_id: movementId, p_lancamento_id: lancamentoId,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/conciliacao`)
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
}

export interface ConciliacaoItem { lancamentoId: string; valor: number }

/**
 * Concilia um movimento com N lançamentos (1 Pix = 2 notas, 5 compras = 1 débito,
 * baixa parcial). O servidor valida que a soma dos itens bate 100% com o movimento.
 */
export async function conciliarMovimentoMulti(orgSlug: string, movementId: string, itens: ConciliacaoItem[]) {
  const { supabase, userId } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('conciliar_btg_multi', {
    p_user_id: userId, p_movement_id: movementId,
    p_itens: itens.map(i => ({ lancamento_id: i.lancamentoId, valor: i.valor })),
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/conciliacao`)
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
}

export interface NovoLancamentoConc {
  tipo: 'entrada' | 'saida'
  contato_tipo?: string | null
  contato_nome?: string | null
  descricao?: string | null
  valor: string
  vencimento?: string | null
  conta_id?: string | null
  categoria?: string | null
}

/** Cria um lançamento em aberto direto da tela de conciliação (movimento sem correspondente). */
export async function criarLancamentoConc(orgSlug: string, data: NovoLancamentoConc) {
  const { supabase, orgId, userId } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: id, error } = await (supabase as any).rpc('create_lancamento', {
    p_user_id: userId, p_org_id: orgId, p_data: { ...data, origem_tipo: 'manual', situacao: 'em_aberto' },
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/conciliacao`)
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
  return { id: id as string }
}

/** Movimento sem lançamento correspondente (ex.: transferência interna, rendimento). */
export async function ignorarMovimento(orgSlug: string, movementId: string) {
  const { supabase, userId } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('ignorar_btg_movimento', {
    p_user_id: userId, p_movement_id: movementId,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/conciliacao`)
}

/** Desfaz a conciliação/ignorar — volta o movimento pra pendente (e reabre o lançamento, se ligado). */
export async function desfazerConciliacaoBtg(orgSlug: string, movementId: string) {
  const { supabase, userId } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('desfazer_conciliacao_btg', {
    p_user_id: userId, p_movement_id: movementId,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/conciliacao`)
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
}
