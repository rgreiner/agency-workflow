'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'

export async function updateProfile(
  fullName: string,
  avatarUrl: string,
  driveMacUser?: string | null,
  driveGoogleEmail?: string | null,
  driveLang?: string | null,
) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('update_profile', {
    p_full_name:  fullName.trim(),
    p_avatar_url: avatarUrl || null,
    p_drive_mac_user:     driveMacUser?.trim() || null,
    p_drive_google_email: driveGoogleEmail?.trim() || null,
    p_drive_lang: driveLang === 'en' ? 'en' : 'pt',
  })

  if (error) return { error: error.message }
  revalidatePath('/', 'layout')
}

/**
 * Grava as preferências de notificação (evento × canal) do próprio usuário na
 * org — migration 254. O RPC valida com whitelist; o filtro real é o trigger.
 */
export async function setNotificationPrefs(orgSlug: string, prefs: import('@/lib/notification-prefs').NotifPrefs) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }

  // RPC novo (mig. 254) ainda não está nos tipos gerados — cast como o resto do app.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('set_notification_prefs', {
    p_user_id: user.id,
    p_org_id: org.id,
    p_prefs: prefs,
  })
  if (error) return { error: error.message }
  return {}
}

/** Liga/desliga o resumo diário por e-mail (8h30) do próprio usuário. */
export async function setDigestEnabled(enabled: boolean) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('set_digest_enabled', { p_user_id: user.id, p_enabled: enabled })
  if (error) return { error: error.message }
  return {}
}
