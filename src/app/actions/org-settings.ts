'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { StatusOverride } from '@/types'

export async function upsertOrgSettings(
  orgId: string,
  logoUrl: string | null,
  accentColor: string,
  statusOverrides: StatusOverride[],
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('upsert_org_settings', {
    p_user_id:          user.id,
    p_org_id:           orgId,
    p_logo_url:         logoUrl,
    p_accent_color:     accentColor,
    p_status_overrides: statusOverrides,
  })

  if (error) return { error: error.message }
  revalidatePath('/', 'layout')
}
