'use server'

import { revalidatePath } from 'next/cache'
import { assertFinanceAccess } from '@/lib/finance'
import { getBtgAccess } from '@/lib/btg/session'
import { listAccounts, getStatement, flattenMovements } from '@/lib/btg/api'
import { setBtgAccount, markBtgSynced, markBtgError, deleteBtgConnection } from '@/lib/btg/store'

export async function disconnectBtg(orgSlug: string) {
  const { orgId } = await assertFinanceAccess(orgSlug)
  await deleteBtgConnection(orgId)
  revalidatePath(`/${orgSlug}/financeiro/contas`)
}

/**
 * Testa a conexão ponta a ponta: renova o token, lista contas e puxa o extrato dos
 * últimos 7 dias (prova de que o fluxo funciona). Guarda a conta e marca o sync.
 */
export async function testBtg(orgSlug: string) {
  const { orgId } = await assertFinanceAccess(orgSlug)
  try {
    const { accessToken, companyId, accountId } = await getBtgAccess(orgId)
    if (!companyId) return { error: 'Falta o CNPJ (BTG_COMPANY_ID) na configuração do servidor.' }

    const accts = await listAccounts(companyId, accessToken)
    let conta = accountId
    if (!conta && accts[0]) { conta = accts[0].accountId; await setBtgAccount(orgId, conta) }
    if (!conta) return { error: 'Nenhuma conta retornada pelo BTG.' }

    const today = new Date().toISOString().slice(0, 10)
    const from = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)
    const st = await getStatement(companyId, conta, from, today, accessToken)
    const movimentos = flattenMovements(st).length

    await markBtgSynced(orgId)
    revalidatePath(`/${orgSlug}/financeiro/contas`)
    return { ok: true, contas: accts.length, movimentos, saldo: st.balance?.current ?? null }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao consultar o BTG.'
    await markBtgError(orgId, msg)
    revalidatePath(`/${orgSlug}/financeiro/contas`)
    return { error: msg }
  }
}
