'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'

/** Resolve/reabre um ou vários erros de uma vez (ex.: um grupo de erros idênticos). */
export async function resolveSystemErrors(orgSlug: string, errorIds: string[], resolved: boolean) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  for (const id of errorIds) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).rpc('resolve_system_error', {
      p_user_id: user.id, p_error_id: id, p_resolved: resolved,
    })
    if (error) return { error: error.message }
  }
  revalidatePath(`/${orgSlug}/settings/erros`)
}
