'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'

/** Gestão de férias e 13º (migration 201). Períodos aquisitivos são CALCULADOS
 *  da data de admissão — só o gozo é gravado. */

async function ctx(orgSlug: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' as const }
  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' as const }
  return { supabase, orgId: org.id as string }
}

export interface PeriodoFerias {
  colaborador_id: string; pessoa: string; data_admissao: string
  periodo_inicio: string; periodo_fim: string; limite: string
  dias_direito: number; dias_gozados: number; dias_programados: number; dias_saldo: number
  em_formacao: boolean; dias_para_limite: number
  situacao: 'em_formacao' | 'aberto' | 'vence_em_breve' | 'vencido' | 'quitado' | 'quitado_pre_flow'
}

export interface LinhaDecimo {
  colaborador_id: string; pessoa: string; meses: number
  base: number; total: number; parcela1: number; parcela2: number
  venc1: string; venc2: string
}

export async function programarFerias(orgSlug: string, dados: {
  colaborador_id: string; periodo_inicio: string; inicio: string; fim: string
  abono_dias?: number; status?: string; observacao?: string | null
}) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_ferias_programar', { p_dados: dados })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/ferias`)
  return { resultado: data as { ok: boolean; dias: number; saldo_restante: number } }
}

export async function mudarStatusFerias(orgSlug: string, id: string, status: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_ferias_status', { p_id: id, p_status: status })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/ferias`)
  return { ok: true }
}

/* ── Saldo do ano: a régua da casa (migration 204) ─────────────────────────
 * 2,5 dias por mês do ano civil; emenda de feriado custa 1 dia; o resto é
 * gozado no recesso, com volta = início + saldo. Convive com o painel da CLT
 * acima — são duas contabilidades da mesma coisa, e o RH opera esta.        */

export interface SaldoAno {
  colaborador_id: string; pessoa: string; data_admissao: string
  meses_ate_hoje: number; dias_ate_hoje: number
  meses_ano: number; dias_ano: number
  dias_pontes: number; dias_lancamentos: number
  saldo_atual: number; saldo_projetado: number
  recesso_inicio: string | null; recesso_retorno: string | null; retorno_ajustado: boolean
}

/** Uma linha por (emenda × pessoa elegível), com a adesão já resolvida. */
export interface PonteLinha {
  ponte_id: string; nome: string; inicio: string; fim: string; custo_dias: number
  observacao: string | null; colaborador_id: string; pessoa: string; aderiu: boolean
}

export interface LancamentoFerias {
  id: string; colaborador_id: string; inicio: string; fim: string
  dias: number; tipo: 'avulso' | 'ferias'; motivo: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function chamar(orgSlug: string, rpc: string, args: any) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc(rpc, args)
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/ferias`)
  return { data }
}

export async function salvarPonte(orgSlug: string, dados: {
  id?: string | null; inicio: string; fim?: string | null; nome: string
  custo_dias?: number; observacao?: string | null
}) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  return chamar(orgSlug, 'rh_ponte_salvar', { p_dados: { ...dados, org_id: c.orgId } })
}

export async function excluirPonte(orgSlug: string, id: string) {
  return chamar(orgSlug, 'rh_ponte_excluir', { p_id: id })
}

export async function marcarAdesao(orgSlug: string, ponteId: string, colaboradorId: string, aderiu: boolean) {
  return chamar(orgSlug, 'rh_ponte_adesao', {
    p_ponte: ponteId, p_colaborador: colaboradorId, p_aderiu: aderiu,
  })
}

export async function lancarDia(orgSlug: string, dados: {
  id?: string | null; colaborador_id: string; inicio: string; fim?: string | null
  dias?: number | null; tipo?: string; motivo?: string | null
}) {
  return chamar(orgSlug, 'rh_ferias_lancar', { p_dados: dados })
}

export async function excluirLancamento(orgSlug: string, id: string) {
  return chamar(orgSlug, 'rh_ferias_lancamento_excluir', { p_id: id })
}

export async function salvarRecesso(orgSlug: string, ano: number, inicio: string, observacao?: string | null) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  return chamar(orgSlug, 'rh_recesso_salvar', {
    p_org: c.orgId, p_ano: ano, p_inicio: inicio, p_observacao: observacao ?? null,
  })
}

/** Retorno nulo devolve a data ao cálculo automático. */
export async function ajustarRetorno(orgSlug: string, ano: number, colaboradorId: string, retorno: string | null) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  return chamar(orgSlug, 'rh_recesso_ajustar', {
    p_org: c.orgId, p_ano: ano, p_colaborador: colaboradorId, p_retorno: retorno,
  })
}

/** Marco de quitação: períodos encerrados até esta data foram gozados no
 *  recesso, antes do Flow (mig. 274). Um por org. */
export async function setFeriasMarco(orgSlug: string, data: string | null) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_set_ferias_marco', {
    p_org: c.orgId, p_data: data,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/ferias`)
  return { ok: true }
}
