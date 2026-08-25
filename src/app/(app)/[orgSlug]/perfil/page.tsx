import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { redirect } from 'next/navigation'
import { ProfileForm } from './ProfileForm'
import type { NotifPrefs } from '@/lib/notification-prefs'

export default async function PerfilPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const supabase = await createClient()

  const authUser = await getUsuario()
  if (!authUser) redirect(`/${orgSlug}`)

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, avatar_url, drive_mac_user, drive_google_email, drive_lang')
    .eq('id', authUser.id)
    .single()

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()

  // Preferência do resumo diário (default ligado se não houver linha).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: prefs } = await (supabase as any)
    .from('user_prefs').select('digest_enabled').eq('user_id', authUser.id).maybeSingle()
  const digestEnabled = prefs?.digest_enabled ?? true

  // Preferências de notificação (evento × canal, mig. 254; sem linha = tudo ligado).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: notifRow } = org ? await (supabase as any)
    .from('user_notification_prefs').select('prefs')
    .eq('user_id', authUser.id).eq('org_id', org.id).maybeSingle()
    : { data: null }
  const notifPrefs: NotifPrefs = (notifRow?.prefs as NotifPrefs | null) ?? {}

  return (
    <ProfileForm
      orgSlug={orgSlug}
      user={{
        id:               authUser.id,
        email:            authUser.email ?? '',
        fullName:         profile?.full_name ?? null,
        avatarUrl:        profile?.avatar_url ?? null,
        googleName:       null,
        googleAvatar:     null,
        driveMacUser:     (profile as { drive_mac_user?: string | null } | null)?.drive_mac_user ?? null,
        driveGoogleEmail: (profile as { drive_google_email?: string | null } | null)?.drive_google_email ?? null,
        driveLang:        (profile as { drive_lang?: string | null } | null)?.drive_lang ?? 'pt',
      }}
      digestEnabled={digestEnabled}
      notifPrefs={notifPrefs}
    />
  )
}
