'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'

async function ctx(orgSlug: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' as const }
  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' as const }
  return { supabase, orgId: org.id as string, userId: user.id as string }
}

export interface EventoTL {
  id: string; tipo: string; data_efeito: string
  titulo: string | null; descricao: string | null
  salario_de: number | null; salario_para: number | null; percentual: number | null
  cargo_de: string | null; cargo_para: string | null
  lote_id: string | null; doc_id: string | null
  /** Registrado depois da vigência = ajuste de histórico (caso da convenção). */
  retroativo: boolean; registrado_em: string; por: string | null
}

export async function carregarTimeline(colaboradorId: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).rpc('rh_timeline', { p_colaborador: colaboradorId })
  return (data ?? []) as EventoTL[]
}

export async function salvarEvento(orgSlug: string, id: string | null, dados: {
  colaborador_id: string; tipo: string; data_efeito: string
  titulo?: string | null; descricao?: string | null
  salario_de?: number | null; salario_para?: number | null; percentual?: number | null
  cargo_de?: string | null; cargo_para?: string | null
}) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_evento_salvar', {
    p_org: c.orgId, p_id: id, p_dados: dados,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/${dados.colaborador_id}`)
  return { ok: true }
}

export async function excluirEvento(orgSlug: string, id: string, colaboradorId: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_evento_excluir', { p_id: id })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/${colaboradorId}`)
  return { ok: true }
}

export interface PreviaReajuste {
  data_efeito: string; percentual: number; meses_retroativos: number
  pessoas: {
    colaborador_id: string; nome: string; cargo: string | null
    salario_de: number; salario_para: number; diferenca: number; retroativo: number
  }[]
}

/** Prévia do reajuste coletivo — não grava nada. */
export async function previaReajuste(orgSlug: string, dataEfeito: string, percentual: number, pessoas?: string[]) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_reajuste_previa', {
    p_org: c.orgId, p_data_efeito: dataEfeito, p_percentual: percentual,
    p_pessoas: pessoas?.length ? pessoas : null,
  })
  if (error) return { error: error.message }
  return { ok: true, previa: data as PreviaReajuste }
}

export async function aplicarReajuste(orgSlug: string, dataEfeito: string, percentual: number,
  titulo: string, pessoas?: string[]) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_reajuste_aplicar', {
    p_org: c.orgId, p_data_efeito: dataEfeito, p_percentual: percentual,
    p_titulo: titulo, p_pessoas: pessoas?.length ? pessoas : null,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh`)
  revalidatePath(`/${orgSlug}/rh/painel`)
  return { ok: true, r: data as { lote_id: string; pessoas: number; meses_retroativos: number; retroativo_total: number } }
}

export async function desfazerReajuste(orgSlug: string, loteId: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_reajuste_desfazer', { p_lote: loteId })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh`)
  return { ok: true, revertidos: (data as number) ?? 0 }
}
