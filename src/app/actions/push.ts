'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'

/**
 * Inscrição de web-push do aparelho. A chave pública VAPID vem por action (env
 * de RUNTIME, não NEXT_PUBLIC_*) — o build do Coolify não precisa conhecê-la e
 * trocar a chave não exige rebuild.
 */

export async function pushPublicKey(): Promise<string | null> {
  return process.env.VAPID_PUBLIC_KEY ?? null
}

export async function pushSubscribe(
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent?: string,
) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('push_subscribe', {
    p_endpoint: sub.endpoint, p_p256dh: sub.keys.p256dh, p_auth: sub.keys.auth,
    p_ua: userAgent ?? null,
  })
  if (error) return { error: error.message }
  return { ok: true }
}

export async function pushUnsubscribe(endpoint: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  // RLS: só apaga a própria inscrição.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('push_subscriptions').delete().eq('endpoint', endpoint)
  if (error) return { error: error.message }
  return { ok: true }
}
