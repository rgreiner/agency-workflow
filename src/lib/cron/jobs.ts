import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { digestJob } from './digest'

/**
 * Executor de tarefas agendadas. A rota /api/cron (batida pelo crontab do VPS)
 * chama runCron; cada job decide sua janela e registra a execução em cron_runs.
 * Jobs usam RPCs security-definer p/ ler dados (a rota roda sem usuário = anon).
 *
 * Adicionar um job novo (ex.: digest, cobrança, btg-sync): escrever um CronJob e
 * incluir em JOBS. everyMinutes = periódico; dailyAfterHour = 1x/dia após a hora
 * (horário de Brasília). run() devolve um resumo curto (vai pro cron_runs.detail).
 */
export interface CronCtx {
  supabase: SupabaseClient<Database>
  /** Dry-run: jobs que enviam algo (e-mail) só simulam e reportam o que fariam. */
  dry?: boolean
}
export interface CronJob {
  name: string
  everyMinutes?: number
  dailyAfterHour?: number    // 0–23, horário de Brasília
  dailyAfterMinute?: number  // 0–59 (default 0) — junto do dailyAfterHour
  run: (ctx: CronCtx) => Promise<string>
}

// ── Registro de jobs ─────────────────────────────────────────────────────────
export const JOBS: CronJob[] = [
  {
    // Prova de vida: mantém o cron_runs fresco p/ o health check "cron parado".
    name: 'heartbeat',
    everyMinutes: 30,
    run: async () => 'ok',
  },
  digestJob,   // resumo diário 8h30 (BRT)
  // Futuros (ondas 4/5): 'lembrete-prazo', 'cobranca', 'contratos', 'btg-sync'.
]

// ── Runner ───────────────────────────────────────────────────────────────────
/** Partes da data em horário de Brasília (p/ janelas diárias). */
function brtParts(d: Date): { date: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const get = (t: string) => fmt.find(p => p.type === t)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) }
}

function isDue(job: CronJob, lastIso: string | null, nowMs: number, nowD: Date): boolean {
  if (job.everyMinutes != null) return !lastIso || nowMs - new Date(lastIso).getTime() >= job.everyMinutes * 60_000
  if (job.dailyAfterHour != null) {
    const now = brtParts(nowD)
    const threshold = job.dailyAfterHour * 60 + (job.dailyAfterMinute ?? 0)
    const lastDate = lastIso ? brtParts(new Date(lastIso)).date : ''
    return now.minutes >= threshold && lastDate < now.date  // ainda não rodou HOJE e já passou da hora
  }
  return false
}

/** Roda os jobs devidos (ou só `onlyJob`, forçado). Devolve o status de cada um. */
export async function runCron(
  supabase: SupabaseClient<Database>, onlyJob?: string, dry = false,
): Promise<Record<string, string>> {
  const results: Record<string, string> = {}
  // list_cron_runs é security-definer (a rota roda anon e não leria a tabela via RLS)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: runs } = await (supabase as any).rpc('list_cron_runs')
  const lastByJob = new Map<string, string | null>((runs ?? []).map((r: { job: string; last_run_at: string | null }) => [r.job, r.last_run_at]))
  const nowD = new Date(), nowMs = nowD.getTime()

  for (const job of JOBS) {
    if (onlyJob && job.name !== onlyJob) continue
    const last = lastByJob.get(job.name) ?? null
    if (!onlyJob && !isDue(job, last, nowMs, nowD)) { results[job.name] = 'skip'; continue }
    try {
      const summary = await job.run({ supabase, dry })
      // dry-run não marca execução (senão "pularia" o disparo real do dia)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!dry) await (supabase as any).rpc('mark_cron_run', { p_job: job.name, p_status: 'ok', p_detail: summary })
      results[job.name] = `${dry ? 'dry ' : ''}ok: ${summary}`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).rpc('mark_cron_run', { p_job: job.name, p_status: 'erro', p_detail: msg })
      results[job.name] = `erro: ${msg}`
    }
  }
  return results
}
