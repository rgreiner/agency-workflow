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

/** Quanto do tempo do ponto chegou a virar tarefa de algum cliente. Sem isso a
 *  margem se lê como definitiva: medido em 08/2026, 61% das horas do ponto não
 *  estavam atribuídas — o custo por cliente sai subestimado na mesma proporção. */
export interface CoberturaHoras {
  hPonto: number; hTarefa: number; pctAtribuido: number
}

/** Margem realizada por cliente no período (mig. 266) + a margem alvo da org e
 *  a cobertura da medição de horas — as três leituras que a tela precisa. */
export async function carregarMargemCliente(orgSlug: string, ini: string, fim: string) {
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [{ data, error }, { data: cfg }, { data: pessoas }] = await Promise.all([
    sb.rpc('fin_margem_cliente', { p_org: orgId, p_ini: ini, p_fim: fim }),
    sb.from('org_settings').select('custo_margem_alvo_pct').eq('org_id', orgId).maybeSingle(),
    sb.rpc('horas_por_pessoa', { p_org: orgId, p_ini: ini, p_fim: fim }),
  ])
  if (error) return { error: error.message as string }

  const somaP = ((pessoas ?? []) as { min_ponto: number; min_tarefa: number }[]).reduce(
    (a, p) => ({ ponto: a.ponto + Number(p.min_ponto ?? 0), tarefa: a.tarefa + Number(p.min_tarefa ?? 0) }),
    { ponto: 0, tarefa: 0 })

  return {
    linhas: (data ?? []) as MargemCliente[],
    margemAlvo: Number(cfg?.custo_margem_alvo_pct ?? 20),
    cobertura: somaP.ponto > 0 ? {
      hPonto: Math.round(somaP.ponto / 60),
      hTarefa: Math.round(somaP.tarefa / 60),
      pctAtribuido: Math.round((somaP.tarefa / somaP.ponto) * 100),
    } as CoberturaHoras : null,
  }
}
