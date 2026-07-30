'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'

/**
 * Registra que a pessoa ABRIU esta tarefa agora. É o único dado coletado para o
 * apontamento implícito de horas (migration 166): o tempo dedicado à tarefa é o
 * intervalo entre esta abertura e a próxima, limitado pelo ponto do dia.
 *
 * Silencioso de propósito: se falhar, a tarefa continua funcionando normalmente
 * — telemetria nunca pode derrubar a tela.
 */
export async function registrarFoco(activityId: string, origem: 'modal' | 'pagina') {
  try {
    const supabase = await createClient()
    const user = await getUsuario()
    if (!user) return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any).rpc('registrar_foco', {
      p_activity_id: activityId, p_origem: origem,
    })
    return (data as string | null) ?? null
  } catch {
    return null
  }
}

/** Sinal de vida da aba (a pessoa ainda está com a tarefa aberta e visível). */
export async function focoPing(focoId: string) {
  try {
    const supabase = await createClient()
    const user = await getUsuario()
    if (!user) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).rpc('foco_ping', { p_id: focoId })
  } catch {
    /* telemetria não quebra a tela */
  }
}
