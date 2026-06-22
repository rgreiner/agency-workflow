'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'

export async function updateProfile(
  fullName: string,
  avatarUrl: string,
  driveMacUser?: string | null,
  driveGoogleEmail?: string | null,
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
  })

  if (error) return { error: error.message }
  revalidatePath('/', 'layout')
}
