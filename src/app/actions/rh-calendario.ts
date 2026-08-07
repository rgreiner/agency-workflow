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

// ── Espelho de ponto (validação dia a dia) ──

export interface EspelhoLinha {
  id: string; nome: string; cargo: string | null; tem_login: boolean
  /** false = dispensado de jornada controlada (migration 209). */
  bate_ponto?: boolean
  dias_com_ponto: number; extras_pendentes: number; intervalo_curto: number
  ajustados: number; saldo_min: number
}
export interface EspelhoLista { ini: string; fim: string; competencia: string; colaboradores: EspelhoLinha[] }

/** Lista de colaboradores com o resumo do ciclo (tela 1). */
export async function carregarEspelhoLista(orgSlug: string, competencia: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  const comp = /^\d{4}-\d{2}$/.test(competencia) ? `${competencia}-01` : null
  if (!comp) return { error: 'Competência inválida' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_espelho_lista', { p_org_id: c.orgId, p_competencia: comp })
  if (error) return { error: error.message }
  return { lista: data as EspelhoLista }
}

export interface EspelhoDia {
  data: string; dow: number; esperado_min: number; marcacoes: string[]
  minutos: number; saldo_min: number; intervalo_maior_min: number | null; intervalo_ok: boolean | null
  /** Diferença absorvida pela tolerância do dia (mig. 223); 0 = nada absorvido.
   *  Explica por que 7:55 trabalhadas ficam com saldo zero. */
  tolerado_min?: number
  extra_status: string | null; origem: string | null; motivo: string | null
  feriado: { nome: string | null; tipo: string; carga_min: number | null } | null
  justificativa: {
    tipo: string; descricao: string | null; status: string
    decidido_por: string | null; decidido_em: string | null
    /** Anexo (atestado/declaração) e período coberto — migrations 207/212/218. */
    doc_id?: string | null; ausencia_ini?: string | null; ausencia_fim?: string | null
  } | null
  ajuste: { de: { marcacoes?: string[]; entrada?: string; saida?: string } | null; por: string | null; em: string } | null
  log: { acao: string; antes: string[]; depois: string[]; motivo: string | null; em: string; por: string | null }[]
}
export interface Espelho {
  colaborador: { id: string; nome: string; cargo: string | null; cpf: string | null }
  jornada: { carga_min: number; entrada: string; saida: string; intervalo_min: number; dias_semana: number[]; tolerancia_min?: number }
  ini: string; fim: string; competencia: string
  resumo: { hn_min: number; faltas_min: number; extra_min: number; saldo_min: number }
  dias: EspelhoDia[]
}

/** Espelho de um colaborador: todos os dias do ciclo com o que aconteceu (tela 2). */
export async function carregarEspelho(orgSlug: string, colaboradorId: string, competencia: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  const comp = /^\d{4}-\d{2}$/.test(competencia) ? `${competencia}-01` : null
  if (!comp) return { error: 'Competência inválida' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_espelho', {
    p_org_id: c.orgId, p_colaborador_id: colaboradorId, p_competencia: comp,
  })
  if (error) return { error: error.message }
  return { espelho: data as Espelho }
}

/** RH corrige as marcações de um dia (exige motivo; fica na trilha de auditoria). */
export async function editarPonto(orgSlug: string, colaboradorId: string, data: string, horas: string[], motivo: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_editar_ponto', {
    p_org_id: c.orgId, p_colaborador_id: colaboradorId, p_data: data,
    p_horas: horas, p_motivo: motivo,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/espelho/${colaboradorId}`)
  revalidatePath(`/${orgSlug}/rh/fechamento`)
  return { ok: true }
}

// ── Ciência das divergências (pré-requisito da assinatura) ──

export interface Ciencia {
  data: string; divergencia: string; decisao: 'ciente' | 'explicacao'
  texto: string | null; resposta: string | null; respondido_em: string | null
}

/** A pessoa dá ciência de um dia divergente, ou pede explicação ao RH. */
export async function darCiencia(
  orgSlug: string, colaboradorId: string, competencia: string,
  data: string, divergencia: string, decisao: 'ciente' | 'explicacao', texto?: string,
) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  const comp = /^\d{4}-\d{2}$/.test(competencia) ? `${competencia}-01` : null
  if (!comp) return { error: 'Competência inválida' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_dar_ciencia', {
    p_colaborador_id: colaboradorId, p_competencia: comp, p_data: data,
    p_divergencia: divergencia, p_decisao: decisao, p_texto: texto ?? null,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/ponto/espelho`)
  revalidatePath(`/${orgSlug}/rh/espelho/${colaboradorId}`)
  return { ok: true }
}

/** Ciências já registradas no ciclo + o que ainda falta. */
export async function carregarCiencias(orgSlug: string, colaboradorId: string, competencia: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  const comp = /^\d{4}-\d{2}$/.test(competencia) ? `${competencia}-01` : null
  if (!comp) return { error: 'Competência inválida' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: dadas } = await (c.supabase as any)
    .from('rh_ciencia').select('data, divergencia, decisao, texto, resposta, respondido_em')
    .eq('colaborador_id', colaboradorId).eq('competencia', comp)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pend, error } = await (c.supabase as any).rpc('rh_ciencia_pendente', {
    p_colaborador_id: colaboradorId, p_competencia: comp,
  })
  if (error) return { error: error.message }
  return {
    ciencias: (dadas ?? []) as Ciencia[],
    pendentes: (pend as { pendentes: { data: string; divergencia: string }[] })?.pendentes ?? [],
  }
}

/** RH responde um pedido de explicação. */
export async function responderExplicacao(orgSlug: string, colaboradorId: string, data: string, divergencia: string, resposta: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  if (!resposta.trim()) return { error: 'Escreva a resposta.' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).from('rh_ciencia')
    .update({ resposta: resposta.trim(), respondido_em: new Date().toISOString() })
    .eq('colaborador_id', colaboradorId).eq('data', data).eq('divergencia', divergencia)
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/espelho/${colaboradorId}`)
  return { ok: true }
}
