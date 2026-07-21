'use server'

import { revalidatePath } from 'next/cache'
import { assertFinanceAccess } from '@/lib/finance'
import { syncOrgMovements } from '@/lib/btg/sync'
import { markBtgSynced, markBtgError, deleteBtgConnection } from '@/lib/btg/store'
import { type OfxTxn } from '@/lib/ofx'
import { getUsuario } from '@/lib/auth/server'

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
export async function conciliarMovimentoMulti(
  orgSlug: string, movementId: string, itens: ConciliacaoItem[],
  /** 'auto' = sugestão do sistema aceita em lote; 'manual' = alguém escolheu (migration 131). */
  modo: 'auto' | 'manual' = 'manual',
) {
  const { supabase, userId } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('conciliar_btg_multi', {
    p_user_id: userId, p_movement_id: movementId,
    p_itens: itens.map(i => ({ lancamento_id: i.lancamentoId, valor: i.valor })),
    p_modo: modo,
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

/** Importa as transações de um OFX numa conta (aditivo, dedup por FITID). Grava também
 *  o saldo do banco do extrato (LEDGERBAL), quando vier no arquivo. */
export async function importarOfx(
  orgSlug: string, contaId: string, txns: OfxTxn[],
  saldoBanco?: number | null, saldoBancoData?: string | null,
) {
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  const rows = txns.map(t => ({ fitid: t.fitid, data_mov: t.data, valor: t.valor, tipo: t.tipo, descricao: t.descricao }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('importar_ofx', {
    p_org_id: orgId, p_conta_id: contaId, p_rows: rows,
  })
  if (error) return { error: error.message }
  if (saldoBanco != null) {
    // O LEDGERBAL só vale se for MAIS NOVO que o guardado. Importar um OFX retroativo
    // (ex.: sex–dom depois de já ter subido o de hoje) trazia um saldo antigo, que
    // pisava no atual e fazia a diferença banco × Flow ficar negativa.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: atual } = await (supabase as any).from('contas_financeiras')
      .select('saldo_banco_data').eq('id', contaId).eq('org_id', orgId).maybeSingle()
    const anterior = (atual?.saldo_banco_data as string | null) ?? null
    if (!anterior || !saldoBancoData || saldoBancoData >= anterior) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('contas_financeiras')
        .update({ saldo_banco: saldoBanco, saldo_banco_data: saldoBancoData ?? null })
        .eq('id', contaId).eq('org_id', orgId)
    }
  }
  revalidatePath(`/${orgSlug}/financeiro/contas/${contaId}`)
  revalidatePath(`/${orgSlug}/financeiro/conciliacao`)
  return { result: data as { inserted: number; skipped: number; total: number } }
}

/** Registra o OFX original que acabou de subir pro volume. A contabilidade quer o
 *  documento do banco, não a nossa renderização — sem isso o pacote mensal vai só
 *  com a planilha. Falha aqui não derruba o import: o extrato já entrou. */
export async function registrarArquivoOfx(
  orgSlug: string, contaId: string,
  arq: { nome: string; caminho: string; bytes: number; periodoIni: string | null; periodoFim: string | null },
) {
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  const user = await getUsuario()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('ofx_arquivos').insert({
    org_id: orgId, conta_id: contaId, nome: arq.nome, caminho: arq.caminho,
    bytes: arq.bytes, periodo_ini: arq.periodoIni, periodo_fim: arq.periodoFim,
    created_by: user?.id ?? null,
  })
  if (error) return { error: error.message }
}
