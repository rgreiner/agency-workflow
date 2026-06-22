import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { redirect } from 'next/navigation'
import { ProfileForm } from './ProfileForm'

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
    .select('full_name, avatar_url, drive_mac_user, drive_google_email')
    .eq('id', authUser.id)
    .single()

  return (
    <ProfileForm
      user={{
        id:               authUser.id,
        email:            authUser.email ?? '',
        fullName:         profile?.full_name ?? null,
        avatarUrl:        profile?.avatar_url ?? null,
        googleName:       null,
        googleAvatar:     null,
        driveMacUser:     (profile as { drive_mac_user?: string | null } | null)?.drive_mac_user ?? null,
        driveGoogleEmail: (profile as { drive_google_email?: string | null } | null)?.drive_google_email ?? null,
      }}
    />
  )
}
