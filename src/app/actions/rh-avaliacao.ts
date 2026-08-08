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

export interface Ciclo {
  id: string; nome: string; tipo: string; status: string
  abre_em: string | null; fecha_em: string | null
  min_respondentes: number; ident_par: boolean; ident_ascendente: boolean
  encerrado_em: string | null
}

/** Cria/edita o ciclo. Rascunho é o estado em que a matriz ainda pode mudar. */
export async function salvarCiclo(orgSlug: string, id: string | null, dados: {
  nome: string; tipo: string; abre_em: string | null; fecha_em: string | null
  min_respondentes: number; ident_par: boolean; ident_ascendente: boolean
}) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  if (!dados.nome?.trim()) return { error: 'Dê um nome ao ciclo.' }

  const linha = {
    nome: dados.nome.trim(), tipo: dados.tipo,
    abre_em: dados.abre_em || null, fecha_em: dados.fecha_em || null,
    min_respondentes: Math.max(1, dados.min_respondentes || 3),
    ident_par: dados.ident_par, ident_ascendente: dados.ident_ascendente,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = c.supabase as any
  const { data, error } = id
    ? await sb.from('rh_aval_ciclo').update(linha).eq('id', id).eq('org_id', c.orgId).select('id').single()
    : await sb.from('rh_aval_ciclo').insert({ ...linha, org_id: c.orgId, criado_por: c.userId }).select('id').single()
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/avaliacao`)
  return { ok: true, id: data?.id as string }
}

/** Semeia o cadastro de competências (núcleo comum + blocos por função). */
export async function semearCompetencias(orgSlug: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_aval_semear', { p_org: c.orgId })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/avaliacao`)
  return { ok: true, criadas: (data as number) ?? 0 }
}

export interface SugestaoLinha {
  avaliado_id: string; nome: string; cargo: string | null; funcao: string | null
  gestor: { id: string; nome: string } | null
  liderados: { id: string; nome: string }[]
  pares: { id: string; nome: string; juntos: number }[]
}

/** Sugestão da matriz: gestor, liderados e os pares que mais dividiram atividade. */
export async function sugerirMatriz(orgSlug: string, cicloId: string, dias = 120) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any)
    .rpc('rh_aval_sugerir', { p_ciclo: cicloId, p_dias: dias, p_max_pares: 5 })
  if (error) return { error: error.message }
  return { ok: true, linhas: (data ?? []) as SugestaoLinha[] }
}

/** Grava a matriz revisada pelo RH. */
export async function definirMatriz(orgSlug: string, cicloId: string, matriz: {
  avaliado_id: string; avaliadores: { id: string; relacao: string }[]
}[]) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any)
    .rpc('rh_aval_definir_matriz', { p_ciclo: cicloId, p_matriz: matriz })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/avaliacao/${cicloId}`)
  return { ok: true, convites: (data as number) ?? 0 }
}

export async function mudarStatusCiclo(orgSlug: string, cicloId: string, status: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_aval_status', { p_ciclo: cicloId, p_status: status })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/avaliacao`)
  revalidatePath(`/${orgSlug}/rh/avaliacao/${cicloId}`)
  revalidatePath(`/${orgSlug}/avaliacao`)
  return { ok: true }
}

export interface Pendencia {
  convite_id: string; ciclo_id: string; ciclo: string; tipo: string
  fecha_em: string | null; relacao: string
  avaliado_id: string; avaliado: string; cargo: string | null
  respondido: boolean; identificado: boolean
}

/** O que o usuário logado tem para responder. */
export async function minhasPendencias() {
  try {
    const supabase = await createClient()
    const user = await getUsuario()
    if (!user) return []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any).rpc('rh_aval_minhas_pendencias')
    return (data ?? []) as Pendencia[]
  } catch {
    return []
  }
}

export interface Questionario {
  convite_id: string; ciclo: string; tipo: string; relacao: string
  avaliado: string; cargo: string | null
  identificado: boolean; respondido: boolean
  competencias: { id: string; bloco: string; titulo: string; descricao: string | null; ancoras: Record<string, string> | null }[]
}

export async function carregarQuestionario(conviteId: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('rh_aval_questionario', { p_convite: conviteId })
  if (error) return { error: error.message }
  return { ok: true, q: data as Questionario }
}

export async function responder(orgSlug: string, conviteId: string, respostas: {
  competencia_id: string; nota: number | null; comentario: string | null
}[]) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .rpc('rh_aval_responder', { p_convite: conviteId, p_respostas: respostas })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/avaliacao`)
  return { ok: true }
}

export async function carregarResultado(cicloId: string, avaliadoId: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .rpc('rh_aval_resultado', { p_ciclo: cicloId, p_avaliado: avaliadoId })
  if (error) return { error: error.message }
  return { ok: true, r: data }
}

export async function carregarProgresso(orgSlug: string, cicloId: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_aval_progresso', { p_ciclo: cicloId })
  if (error) return { error: error.message }
  return { ok: true, p: data }
}

/** Função avaliada da pessoa (escolhe o bloco do questionário). */
export async function setFuncaoAvaliacao(orgSlug: string, colaboradorId: string, funcao: string | null) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).from('rh_colaborador')
    .update({ aval_funcao: funcao || null }).eq('id', colaboradorId).eq('org_id', c.orgId)
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/avaliacao`)
  return { ok: true }
}
