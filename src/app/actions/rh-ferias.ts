'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'

/** Gestão de férias e 13º (migration 201). Períodos aquisitivos são CALCULADOS
 *  da data de admissão — só o gozo é gravado. */

async function ctx(orgSlug: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' as const }
  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' as const }
  return { supabase, orgId: org.id as string }
}

export interface PeriodoFerias {
  colaborador_id: string; pessoa: string; data_admissao: string
  periodo_inicio: string; periodo_fim: string; limite: string
  dias_direito: number; dias_gozados: number; dias_programados: number; dias_saldo: number
  em_formacao: boolean; dias_para_limite: number
  situacao: 'em_formacao' | 'aberto' | 'vence_em_breve' | 'vencido' | 'quitado'
}

export interface LinhaDecimo {
  colaborador_id: string; pessoa: string; meses: number
  base: number; total: number; parcela1: number; parcela2: number
  venc1: string; venc2: string
}

export async function programarFerias(orgSlug: string, dados: {
  colaborador_id: string; periodo_inicio: string; inicio: string; fim: string
  abono_dias?: number; status?: string; observacao?: string | null
}) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_ferias_programar', { p_dados: dados })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/ferias`)
  return { resultado: data as { ok: boolean; dias: number; saldo_restante: number } }
}

export async function mudarStatusFerias(orgSlug: string, id: string, status: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_ferias_status', { p_id: id, p_status: status })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/ferias`)
  return { ok: true }
}
