'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { enviarPacoteFechamento, type ResultadoEnvio } from '@/lib/rh/envio-fechamento'

/** O ciclo congelado (mig. 256) — snapshot que a contabilidade recebe. */
export interface RunRhLinha {
  colaborador_id: string; nome: string; cpf: string | null; cargo: string | null
  ini: string; fim: string
  hn_min: number; he50_min: number; he100_min: number; faltas_min: number
  total_min: number; quitacao_min: number; pendente_min: number; dias_com_ponto: number
}
export interface RunRh {
  id: string; competencia: string; ini: string; fim: string
  status: string; versao: number
  fechado_em: string; reaberto_em: string | null; reaberto_motivo: string | null
  enviado_em: string | null; destinatarios: string[] | null; envios: number
  /** true = ciclo interno (sócio/estagiário): fecha e não vai à contabilidade. */
  sem_envio: boolean
  vr_valor: number | null; vt_valor: number | null; corpo: string | null
  rh_fechamento_run_linha: RunRhLinha[]
}

async function ctx(orgSlug: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' as const }
  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' as const }
  return { supabase, orgId: org.id as string, userId: user.id as string }
}

/** Congela o ciclo com as pessoas escolhidas (ini/fim próprios opcionais). */
export async function fecharCiclo(orgSlug: string, competencia: string,
  pessoas: { id: string; ini?: string; fim?: string }[]) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  if (!/^\d{4}-\d{2}$/.test(competencia)) return { error: 'Competência inválida' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_fechar_ciclo', {
    p_org_id: c.orgId, p_competencia: `${competencia}-01`, p_pessoas: pessoas,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/fechamento`)
  return { ok: true, runId: (data as { run_id: string }).run_id }
}

/** Marca (ou desmarca) o ciclo como interno — fecha sem ir à contabilidade.
 *  Sócio e estagiário: o espelho fica registrado, o e-mail não existe. */
export async function marcarSemEnvio(orgSlug: string, runId: string, semEnvio: boolean) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_fechamento_sem_envio', {
    p_run: runId, p_sem_envio: semEnvio,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/fechamento`)
  return { ok: true }
}

export async function reabrirFechamento(orgSlug: string, runId: string, motivo: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_reabrir_fechamento', { p_run: runId, p_motivo: motivo })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/fechamento`)
  return { ok: true }
}

/** E-mails do RH da contabilidade — separado do fechamento financeiro. */
export async function salvarEmailsContabilidadeRh(orgSlug: string, emails: string[]) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  const limpos = emails.map(e => e.trim()).filter(Boolean)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_salvar_contabil_emails', {
    p_org_id: c.orgId, p_emails: limpos,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/fechamento`)
  return { ok: true, emails: limpos }
}

/**
 * Dispara o e-mail para o RH da contabilidade: espelho em PDF (uma página por
 * pessoa, período próprio de cada linha) + resumo em CSV, com o corpo revisado
 * na tela. Só por ação humana; `reenviar` marca a versão corrigida — mesmo
 * fluxo do fechamento financeiro. O pacote mora em lib/rh/envio-fechamento.
 */
export async function enviarFechamentoRh(orgSlug: string, runId: string, dados: {
  vr: number | null; vt: number | null; corpo: string; reenviar?: boolean
}): Promise<ResultadoEnvio> {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = c.supabase as any

  const { data: run } = await sb.from('rh_fechamento_run')
    .select('id, competencia, ini, fim, status, enviado_em, rh_fechamento_run_linha(colaborador_id, nome, cpf, cargo, ini, fim, hn_min, he50_min, he100_min, faltas_min, total_min, quitacao_min, pendente_min, dias_com_ponto)')
    .eq('id', runId).eq('org_id', c.orgId).maybeSingle()
  if (!run) return { error: 'Fechamento não encontrado.' }
  const { data: cfg } = await sb.from('org_settings')
    .select('rh_contabil_emails, logo_url').eq('org_id', c.orgId).maybeSingle()
  const r = await enviarPacoteFechamento(sb, c.orgId, c.userId, {
    run, linhas: run.rh_fechamento_run_linha as RunRhLinha[],
    destinatarios: (cfg?.rh_contabil_emails ?? []) as string[], logoUrl: cfg?.logo_url ?? null,
  }, dados)
  if (r.ok) revalidatePath(`/${orgSlug}/rh/fechamento`)
  return r
}
