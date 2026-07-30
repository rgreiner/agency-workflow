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
  return { supabase, orgId: org.id as string }
}

export type TipoFeriado = 'feriado' | 'emenda' | 'facultativo'
export interface Feriado { id: string; data: string; nome: string | null; tipo: string; abona: boolean; extra_100: boolean }

/** Marca (ou atualiza) um dia no calendário: feriado, emenda ou ponto facultativo. */
export async function salvarFeriado(orgSlug: string, data: string, nome: string, tipo: TipoFeriado) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_upsert_feriado', {
    p_org_id: c.orgId, p_data: data, p_nome: nome, p_tipo: tipo,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/calendario`)
  revalidatePath(`/${orgSlug}/rh/fechamento`)
  return { ok: true }
}

/** Desmarca o dia (volta a ser dia útil normal). */
export async function excluirFeriado(orgSlug: string, data: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_delete_feriado', { p_org_id: c.orgId, p_data: data })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/calendario`)
  revalidatePath(`/${orgSlug}/rh/fechamento`)
  return { ok: true }
}

/** Config do fechamento: dia de início do período (1 = mês cheio) + dia do pagamento. */
export async function salvarFechamentoConfig(orgSlug: string, diaIni: number, diaPagamento: number, pagaMesSeguinte: boolean) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_salvar_fechamento_config', {
    p_org_id: c.orgId, p_dia_ini: diaIni, p_dia_pagamento: diaPagamento, p_paga_mes_seguinte: pagaMesSeguinte,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/fechamento`)
  return { ok: true }
}

/** Importa o histórico do Pontomais (uma chamada por pessoa) + feriados detectados. */
export async function importarPontomais(orgSlug: string, payload: {
  dataRef: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pessoas: { nome: string; dias: any[]; saldoFinalMin: number | null }[]
  feriados: { data: string; nome: string; tipo: string }[]
}) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }

  const resultados: { nome: string; dias: number; erro?: string }[] = []
  for (const p of payload.pessoas) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (c.supabase as any).rpc('rh_importar_pontomais', {
      p_org_id: c.orgId, p_nome: p.nome, p_dias: p.dias,
      p_saldo_final_min: p.saldoFinalMin, p_data_ref: payload.dataRef,
    })
    if (error) resultados.push({ nome: p.nome, dias: 0, erro: error.message })
    else resultados.push(data as { nome: string; dias: number; erro?: string })
  }

  let feriados = 0
  for (const f of payload.feriados) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (c.supabase as any).rpc('rh_upsert_feriado', {
      p_org_id: c.orgId, p_data: f.data, p_nome: f.nome, p_tipo: f.tipo,
    })
    if (!error) feriados++
  }

  revalidatePath(`/${orgSlug}/rh/ponto`)
  revalidatePath(`/${orgSlug}/rh/calendario`)
  revalidatePath(`/${orgSlug}/rh/fechamento`)
  return { resultados, feriados }
}

export interface FechamentoLinha {
  colaborador_id: string; nome: string; cpf: string | null; cargo: string | null
  hn_min: number; he50_min: number; he100_min: number; faltas_min: number
  total_min: number; quitacao_min: number; pendente_min: number
  editado_em: string | null; dias_com_ponto: number; dias_esperados: number
}
export interface Fechamento { ini: string; fim: string; competencia: string; linhas: FechamentoLinha[] }

/** Relatório de fechamento da competência (o report que vai para a contabilidade). */
export async function carregarFechamento(orgSlug: string, competencia: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  const comp = /^\d{4}-\d{2}$/.test(competencia) ? `${competencia}-01` : null
  if (!comp) return { error: 'Competência inválida' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_fechamento', {
    p_org_id: c.orgId, p_competencia: comp,
  })
  if (error) return { error: error.message }
  return { fechamento: data as Fechamento }
}
