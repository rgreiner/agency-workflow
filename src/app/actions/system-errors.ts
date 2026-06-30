'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'

/** Marca um erro de sistema como resolvido / reabre (admin). */
export async function resolveSystemError(orgSlug: string, errorId: string, resolved: boolean) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('resolve_system_error', {
    p_user_id: user.id, p_error_id: errorId, p_resolved: resolved,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/settings/erros`)
}
