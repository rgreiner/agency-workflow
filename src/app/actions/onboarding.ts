'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'

/** Uma etapa da trilha, do ponto de vista de quem está percorrendo. */
export interface EtapaTrilha {
  id: string
  ordem: number
  titulo: string
  descricao: string | null
  link: string | null
  link_label: string | null
  concluido: boolean
}

/** Etapa como o admin cadastra (config da org). */
export interface EtapaConfig {
  id: string
  ordem: number
  titulo: string
  descricao: string | null
  link: string | null
  link_label: string | null
  position_ids: string[]
  ativo: boolean
}

async function ctx(orgSlug: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' as const }
  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' as const }
  return { supabase, orgId: org.id as string, userId: user.id }
}

/** Trilha da pessoa: etapas do cargo dela + o que já marcou. */
export async function carregarTrilha(orgSlug: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('onboarding_trilha', { p_org_id: c.orgId })
  if (error) return { error: error.message }
  return { trilha: (data ?? []) as EtapaTrilha[] }
}

/** Marca/desmarca uma etapa da PRÓPRIA trilha. Não bloqueia nada — só orienta. */
export async function marcarEtapa(orgSlug: string, etapaId: string, concluido: boolean) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('onboarding_marcar', {
    p_etapa_id: etapaId, p_concluido: concluido,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/onboarding`)
}

export async function salvarEtapa(orgSlug: string, id: string | null, data: {
  titulo: string; descricao?: string | null; link?: string | null; link_label?: string | null
  position_ids?: string[]; ativo?: boolean; ordem?: number
}) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('onboarding_salvar_etapa', {
    p_org_id: c.orgId, p_id: id, p_data: data,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/settings/onboarding`)
  revalidatePath(`/${orgSlug}/onboarding`)
}

export async function excluirEtapa(orgSlug: string, id: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('onboarding_excluir_etapa', {
    p_org_id: c.orgId, p_id: id,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/settings/onboarding`)
  revalidatePath(`/${orgSlug}/onboarding`)
}
