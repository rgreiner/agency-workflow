/**
 * Sincroniza o extrato do BTG pra uma org: renova o token, garante a conta e faz
 * upsert dos movimentos em `btg_movements` (RPC sync_btg_movements — preserva
 * conciliação já feita). Usado pelo botão manual (Contas/Conciliação) E pelo cron
 * diário (lib/cron/btg-sync.ts) — mesma lógica, dois chamadores.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getBtgAccess } from './session'
import { listAccounts, getStatement, flattenMovements } from './api'
import { setBtgAccount } from './store'

export interface SyncResult {
  contas: number
  movimentos: number
  saldo: number | null
  inserted: number
  updated: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function syncOrgMovements(supabase: SupabaseClient<any>, orgId: string, days = 30): Promise<SyncResult> {
  const { accessToken, companyId, accountId } = await getBtgAccess(orgId)
  if (!companyId) throw new Error('Falta o CNPJ (BTG_COMPANY_ID) na configuração do servidor.')

  const accts = await listAccounts(companyId, accessToken)
  let conta = accountId
  if (!conta && accts[0]) { conta = accts[0].accountId; await setBtgAccount(orgId, conta) }
  if (!conta) throw new Error('Nenhuma conta retornada pelo BTG.')

  const today = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)
  const st = await getStatement(companyId, conta, from, today, accessToken)
  const movs = flattenMovements(st)

  const rows = movs
    .map(m => ({
      btg_id: m.id,
      end_to_end_id: m.endToEndId || null,
      tipo: m.type,
      valor: Math.abs(m.amount),
      data_mov: (m.dateHour || '').slice(0, 10),
      descricao: m.description || m.category?.description || m.category?.name || null,
      categoria: m.category?.name || null,
      raw: m,
    }))
    .filter(r => r.btg_id && r.data_mov)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('sync_btg_movements', { p_org_id: orgId, p_rows: rows })
  if (error) throw new Error(error.message)

  return {
    contas: accts.length,
    movimentos: movs.length,
    saldo: st.balance?.current ?? null,
    inserted: data?.inserted ?? 0,
    updated: data?.updated ?? 0,
  }
}
