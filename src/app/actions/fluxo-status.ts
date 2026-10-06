'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'

/**
 * O fluxo de status MEDIDO da org (mig. 333) — para a tela sugerir o destino.
 *
 * Substitui o palpite anterior, que era "o próximo da ordem do cadastro".
 * Medido em 06/10/2026 sobre 3.980 transições: a ordem acerta o destino mais
 * comum em 7 dos 21 status. Ela é ordem de exibição, não de fluxo.
 */
export interface TransicaoSugerida {
  de: string
  para: string
  vezes: number
  /** Percentual das saídas daquele status. */
  pct: number
  /** 1 = destino mais comum. */
  pos: number
}

export async function transicoesSugeridas(orgId: string): Promise<TransicaoSugerida[]> {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user || !orgId) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('activity_transicoes_sugeridas', { p_org: orgId })
  // Falha aqui não pode derrubar a troca de status: sem sugestão, a lista
  // completa continua lá e a pessoa escolhe como sempre escolheu.
  if (error) return []
  return (data ?? []) as TransicaoSugerida[]
}
