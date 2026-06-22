'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'

/** Regera os lançamentos de comissão das mídias faturadas (botão "Gerar Lançamentos"). */
export async function regerarLancamentos(orgSlug: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('regerar_lancamentos_midias', {
    p_user_id: user.id, p_org_id: org.id,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/faturamento`)
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
}
