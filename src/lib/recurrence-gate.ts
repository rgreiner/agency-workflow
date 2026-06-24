import 'server-only'
import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const CONCLUIDO = 'concluido'

/** A atividade está sendo concluída agora? (entrou em 'concluido') */
export function isConclusion(from: string | null | undefined, to: string): boolean {
  return to === CONCLUIDO && from !== CONCLUIDO
}

/**
 * Agenda (em 2º plano) a reabertura de uma tarefa recorrente após a conclusão.
 * A RPC `recur_activity` decide internamente se há recorrência/repetições
 * restantes — se não houver, é no-op. Nunca lança; falhas vão só pro log.
 */
export function scheduleRecurrence(params: {
  supabase: SupabaseClient<Database>
  userId: string
  activityId: string
}) {
  const { supabase, userId, activityId } = params
  after(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).rpc('recur_activity', { p_user_id: userId, p_activity_id: activityId })
    } catch (e) {
      console.error('[recurrence] falha ao reabrir tarefa recorrente', e)
    }
  })
}
