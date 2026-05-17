import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ProfileForm } from './ProfileForm'

export default async function PerfilPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const supabase = await createClient()

  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) redirect(`/${orgSlug}`)

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, avatar_url')
    .eq('id', authUser.id)
    .single()

  const meta = authUser.user_metadata ?? {}

  return (
    <ProfileForm
      user={{
        id:           authUser.id,
        email:        authUser.email ?? '',
        fullName:     profile?.full_name ?? null,
        avatarUrl:    profile?.avatar_url ?? null,
        googleName:   (meta.full_name as string) ?? null,
        googleAvatar: (meta.avatar_url as string) ?? null,
      }}
    />
  )
}
