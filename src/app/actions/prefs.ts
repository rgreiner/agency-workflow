'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'

/** Grava as preferências de uma view (colunas/filtros salvos) do usuário. RLS garante
 *  que só grava as próprias. Best-effort: falha silenciosa (localStorage é o fallback). */
export async function setViewPrefs(orgSlug: string, view: string, prefs: Record<string, unknown>) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return
  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('user_view_prefs').upsert(
    { user_id: user.id, org_id: org.id, view, prefs, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,org_id,view' },
  )
}

/** Carrega as preferências salvas do usuário para uma view (ou null). */
export async function loadViewPrefs(orgSlug: string, view: string): Promise<Record<string, unknown> | null> {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return null
  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).from('user_view_prefs')
    .select('prefs').eq('user_id', user.id).eq('org_id', org.id).eq('view', view).maybeSingle()
  return (data?.prefs ?? null) as Record<string, unknown> | null
}
