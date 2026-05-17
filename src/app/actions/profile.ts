'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function updateProfile(fullName: string, avatarUrl: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('update_profile', {
    p_full_name:  fullName.trim(),
    p_avatar_url: avatarUrl || null,
  })

  if (error) return { error: error.message }
  revalidatePath('/', 'layout')
}
