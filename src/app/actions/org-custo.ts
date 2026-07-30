'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'

/**
 * Config do custo/preço da hora (migration 170) — owner/admin (o banco cobra).
 * `impostoPct` vazio = voltar ao automático (DAS pago ÷ recebido, 12 meses).
 */
export async function setCustoConfig(orgSlug: string, orgId: string, data: {
  provisaoLucro?: number
  margemAlvoPct?: number
  impostoPct?: number | null
}) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const payload: Record<string, string> = {}
  if (data.provisaoLucro != null) payload.provisao_lucro = String(data.provisaoLucro)
  if (data.margemAlvoPct != null) payload.margem_alvo_pct = String(data.margemAlvoPct)
  if ('impostoPct' in data) payload.imposto_pct = data.impostoPct == null ? '' : String(data.impostoPct)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('set_custo_config', { p_org: orgId, p_data: payload })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/horas`)
  return { ok: true }
}
