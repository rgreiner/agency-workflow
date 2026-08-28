'use server'

import { assertFinanceAccess } from '@/lib/finance'

/** Uma linha da margem realizada — o cruzamento receita × custo do tempo. */
export interface MargemCliente {
  workspace_id: string | null
  cliente: string
  /** true = a própria agência (receita/custo da casa, não de cliente). */
  agencia: boolean
  receita: number
  imposto: number
  horas: number
  custo_horas: number
  custo_direto: number
  margem: number
  /** null quando não houve receita no período (só custo). */
  margem_pct: number | null
}

/** Margem realizada por cliente no período (mig. 266) + a margem alvo da org,
 *  para a tela comparar realizado × alvo sem uma segunda consulta. */
export async function carregarMargemCliente(orgSlug: string, ini: string, fim: string) {
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [{ data, error }, { data: cfg }] = await Promise.all([
    sb.rpc('fin_margem_cliente', { p_org: orgId, p_ini: ini, p_fim: fim }),
    sb.from('org_settings').select('custo_margem_alvo_pct').eq('org_id', orgId).maybeSingle(),
  ])
  if (error) return { error: error.message as string }
  return {
    linhas: (data ?? []) as MargemCliente[],
    margemAlvo: Number(cfg?.custo_margem_alvo_pct ?? 20),
  }
}
