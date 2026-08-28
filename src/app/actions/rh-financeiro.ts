'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'

/** Uma pessoa × mês na conferência entre a folha prevista e o time real. */
export interface ConferenciaLinha {
  mes: string
  colaborador_id: string | null
  nome: string | null
  /** Grafia como está no lançamento — só difere quando o vínculo é aproximado. */
  nome_financeiro: string | null
  previsto: number
  esperado: number
  /** ok | sobra | falta | divergente | nome_divergente | fora_do_time */
  situacao: string
  data_admissao: string | null
  data_demissao: string | null
  lancamentos: number
}

export interface LancFuturo {
  id: string; vencimento: string; valor: number
  categoria: string | null; descricao: string; situacao: string
}

async function ctx(orgSlug: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' as const }
  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' as const }
  return { supabase, orgId: org.id as string }
}

/** Folha prevista no fluxo × time real do RH, mês a mês (mig. 268). */
export async function carregarConferenciaFolha(orgSlug: string, meses = 6) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_fin_conferencia_folha', {
    p_org: c.orgId, p_meses: meses,
  })
  if (error) return { error: error.message as string }
  return { linhas: (data ?? []) as ConferenciaLinha[] }
}

/** O que ainda está previsto para uma pessoa — o aviso do desligamento. */
export async function lancamentosFuturosPessoa(orgSlug: string, colaboradorId: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_lanc_futuros_pessoa', {
    p_colaborador: colaboradorId,
  })
  if (error) return { error: error.message as string }
  return { linhas: (data ?? []) as LancFuturo[] }
}
