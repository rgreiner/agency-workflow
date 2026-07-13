/**
 * Chamadas às APIs bancárias do BTG Empresas (base https://api.empresas.btgpactual.com).
 * Recebem um access token válido (obtido via refresh). Read-only por ora
 * (contas + extrato) — é o que a conciliação precisa.
 */
import { btgConfig } from './config'

export interface BtgAccount {
  accountId: string
  taxId: string
  bankCode: number
  branchCode: string
  number: string
}

export interface BtgMovement {
  id: string
  type: string            // 'debit' | 'credit'
  amount: number
  dateHour: string        // ISO
  description: string
  category?: { name?: string; description?: string }
  descriptionDetails?: string
  txId?: string
  endToEndId?: string
  details?: { originId?: string; barcode?: string; ourNumber?: string }
}

export interface BtgStatement {
  accountNumber?: number
  balance?: { initial?: number; current?: number; final?: number }
  dailyMovements: { date: string; balance: number; movements: BtgMovement[] }[]
}

async function btgGet<T>(path: string, accessToken: string): Promise<T> {
  const c = btgConfig()
  const res = await fetch(`${c.apiBase}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`BTG API ${res.status} ${path}: ${text.slice(0, 300)}`)
  return JSON.parse(text) as T
}

/** Lista as contas PJ da empresa (p/ descobrir o accountId). */
export async function listAccounts(companyId: string, accessToken: string): Promise<BtgAccount[]> {
  const r = await btgGet<{ data?: BtgAccount[] }>(`/${companyId}/banking/accounts`, accessToken)
  return r.data ?? []
}

/** Extrato de uma conta no período (YYYY-MM-DD). type=simple = sem rendimentos. */
export async function getStatement(
  companyId: string, accountId: string, startDate: string, endDate: string, accessToken: string,
): Promise<BtgStatement> {
  const q = new URLSearchParams({ startDate, endDate, type: 'simple' })
  const r = await btgGet<{ data?: BtgStatement }>(
    `/${companyId}/banking/accounts/${accountId}/statements?${q.toString()}`, accessToken,
  )
  return r.data ?? { dailyMovements: [] }
}

/** Achata os movimentos diários numa lista única (com a data do dia herdada). */
export function flattenMovements(st: BtgStatement): BtgMovement[] {
  return (st.dailyMovements ?? []).flatMap(d => d.movements ?? [])
}
