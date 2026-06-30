import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Registra um erro de sistema (tabela system_errors) p/ o admin ver em Configurações,
 * em vez de expor o dump técnico ao usuário. Nunca lança — falha de log só vai pro console.
 */
export async function logSystemError(
  supabase: SupabaseClient<Database>,
  opts: { userId: string; context: string; error: unknown; activityId?: string | null },
) {
  try {
    const { error } = opts
    const message = error instanceof Error ? error.message : String(error)
    let detail: string | null
    if (error instanceof Error) detail = error.stack ?? message
    else { try { detail = JSON.stringify(error, null, 2) } catch { detail = String(error) } }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).rpc('log_system_error', {
      p_user_id: opts.userId,
      p_context: opts.context,
      p_message: message.slice(0, 500),
      p_detail: detail ? detail.slice(0, 8000) : null,
      p_activity_id: opts.activityId ?? null,
    })
  } catch (e) {
    console.error('[system-error] falha ao registrar erro', e)
  }
}
