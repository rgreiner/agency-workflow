import 'server-only'
import type { CronJob } from './jobs'

/**
 * Abre o fechamento contábil do mês anterior e avisa o Financeiro na caixa de
 * entrada. NÃO envia nada — quem dispara o e-mail pra contabilidade é uma pessoa,
 * depois de conferir que as contas estão atualizadas (decisão do Rafael: relatório
 * fiscal saindo sozinho transforma erro em problema com o contador).
 *
 * O dia é configurável por org (org_settings.contabil_dia, default 5); o job roda
 * a partir do dia 1 e cada org decide se já é a hora dela.
 */
export const fechamentoContabilJob: CronJob = {
  name: 'fechamento-contabil',
  monthlyOnDay: 1,
  dailyAfterHour: 7,
  run: async ({ supabase, dry }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any

    const { data: cfgs, error } = await sb
      .from('org_settings')
      .select('org_id, contabil_dia, contabil_ativo, contabil_emails')
      .eq('contabil_ativo', true)
    if (error) throw new Error(error.message)
    if (!cfgs?.length) return 'nenhuma org com envio contábil ativo'

    // Competência = mês anterior, em horário de Brasília.
    const agora = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())
    const [ano, mes, dia] = agora.split('-').map(Number)
    const ref = new Date(Date.UTC(ano, mes - 1, 1))
    ref.setUTCMonth(ref.getUTCMonth() - 1)
    const competencia = `${ref.getUTCFullYear()}-${String(ref.getUTCMonth() + 1).padStart(2, '0')}`

    const partes: string[] = []
    for (const cfg of cfgs as { org_id: string; contabil_dia: number; contabil_emails: string[] }[]) {
      if (dia < (cfg.contabil_dia ?? 5)) continue          // ainda não é o dia dessa org
      if (!cfg.contabil_emails?.length) {                   // sem destinatário não adianta abrir
        partes.push(`${cfg.org_id.slice(0, 8)}: sem e-mail da contabilidade`)
        continue
      }
      if (dry) { partes.push(`${cfg.org_id.slice(0, 8)}: abriria ${competencia}`); continue }

      const { data, error: e2 } = await sb.rpc('abrir_fechamento_contabil', {
        p_org_id: cfg.org_id, p_competencia: competencia,
      })
      if (e2) { partes.push(`${cfg.org_id.slice(0, 8)}: erro ${e2.message}`); continue }
      partes.push(data?.criado
        ? `${cfg.org_id.slice(0, 8)}: ${competencia} aberto, ${data.notificados} avisado(s)`
        : `${cfg.org_id.slice(0, 8)}: ${competencia} já estava aberto`)
    }

    return partes.length ? partes.join(' | ') : 'nenhuma org no dia de fechar'
  },
}
