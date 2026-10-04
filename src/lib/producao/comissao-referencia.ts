import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * A régua de comissão que a casa pratica, para aparecer ao lado do campo.
 *
 * NÃO é média, de propósito. Medido em 03/10/2026 nos 30 pedidos com comissão:
 * 26 estão em 15,00%, 2 em 12,9% e 2 em 10,0%. A média (14,53%) descreve um
 * meio-termo que nunca foi praticado e esconde o que importa — existe um padrão
 * da casa e exceções contadas nos dedos.
 *
 * Quem está fechando um pedido não precisa de uma estatística; precisa saber se
 * está saindo do padrão e quantas vezes isso já aconteceu.
 */
export interface ComissaoReferencia {
  /** Percentual mais praticado. */
  padrao: number
  /** Quantos pedidos nesse percentual, de quantos no total. */
  noPadrao: number
  total: number
  minimo: number
  maximo: number
}

export async function referenciaDeComissao(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>, orgId: string,
): Promise<ComissaoReferencia | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('producao').select('bv_pct').eq('org_id', orgId).eq('serie', 'PP')

  const pcts = ((data ?? []) as { bv_pct: number | null }[])
    .map(r => Number(r.bv_pct ?? 0))
    .filter(n => Number.isFinite(n) && n > 0)

  // Com pouquíssimo histórico a "régua da casa" seria só o último pedido com
  // outro nome. Melhor não dizer nada do que inventar um padrão.
  if (pcts.length < 5) return null

  const freq = new Map<number, number>()
  for (const p of pcts) freq.set(p, (freq.get(p) ?? 0) + 1)
  const [padrao, noPadrao] = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]

  return {
    padrao, noPadrao, total: pcts.length,
    minimo: Math.min(...pcts), maximo: Math.max(...pcts),
  }
}

/** Uma linha do painel de comissão por cliente. */
export interface ComissaoPorCliente {
  cliente: string
  pedidos: number
  valor: number
  /** Ponderada pelo valor: um PP de R$ 46.800 não pode pesar igual a um de R$ 500. */
  comissaoPct: number
  minimo: number
  maximo: number
}

/**
 * Comissão praticada por cliente, ponderada pelo valor.
 *
 * Ponderada e não média simples porque a pergunta é "quanto a casa ganhou por
 * real faturado neste cliente", e não "qual o percentual típico de um pedido".
 * Com um PP de R$ 46.800 a 10% e um de R$ 500 a 20%, a média simples diz 15% e
 * a realidade é 10,1%.
 */
export async function comissaoPorCliente(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>, orgId: string, desde?: string,
): Promise<ComissaoPorCliente[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any).from('producao')
    .select('bv_pct, valor, created_at, workspaces(name)')
    .eq('org_id', orgId).eq('serie', 'PP')
  if (desde) q = q.gte('created_at', desde)
  const { data } = await q

  const porCliente = new Map<string, { v: number; vp: number; n: number; min: number; max: number }>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (data ?? []) as any[]) {
    const pct = Number(r.bv_pct ?? 0), valor = Number(r.valor ?? 0)
    if (!(pct > 0) || !(valor > 0)) continue
    const nome = r.workspaces?.name ?? 'Sem cliente'
    const a = porCliente.get(nome) ?? { v: 0, vp: 0, n: 0, min: pct, max: pct }
    porCliente.set(nome, {
      v: a.v + valor, vp: a.vp + valor * pct, n: a.n + 1,
      min: Math.min(a.min, pct), max: Math.max(a.max, pct),
    })
  }

  return [...porCliente.entries()]
    .map(([cliente, a]) => ({
      cliente, pedidos: a.n, valor: a.v,
      comissaoPct: a.v > 0 ? a.vp / a.v : 0,
      minimo: a.min, maximo: a.max,
    }))
    .sort((a, b) => b.valor - a.valor)
}
