import 'server-only'
import { sendMail } from '@/lib/email/send'
import { htmlCobranca, assuntoCobranca, tomPorDias } from '@/lib/email/cobranca'
import type { CronJob } from './jobs'

interface Aviso {
  lancamento_id: string; bucket: string
  org_slug: string; org_name: string; cliente: string; email: string
  descricao: string; valor: number; vencimento: string; dias: number; payment_info: string
}

/**
 * Régua de cobrança: e-mail ao cliente nos degraus configurados em
 * `org_settings.cobranca_regua` (default D-3, D0, D+3, D+7, D+15, D+30, D+60,
 * D+90). 1x/dia, seg–sex, 9h BRT.
 *
 * Toda a decisão de QUEM cobrar mora no `cobranca_payload` (migration 189) —
 * inclusive as travas: régua desligada na org, `payment_info` vazio, cliente sem
 * opt-in ou sem e-mail financeiro, promessa de pagamento em dia, e o degrau já
 * enviado. Aqui só se monta o e-mail e se registra o disparo.
 *
 * Antes da 189 este job cobria só recebível de mídia/produção e parava no D+3 —
 * na prática, com o livro-caixa vindo do Conta Azul, ele nunca mandou nada.
 */
export const cobrancaJob: CronJob = {
  name: 'cobranca',
  dailyAfterHour: 9,
  weekdaysOnly: true,
  run: async ({ supabase, dry, only }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('cobranca_payload')
    if (error) throw new Error(error.message)
    let avisos = (data ?? []) as Aviso[]
    if (only) avisos = avisos.filter(a => a.email?.toLowerCase() === only.toLowerCase())
    if (dry) {
      return `${avisos.length} cobrança(s): ${avisos.map(a => `${a.cliente}/${a.bucket}`).join(', ') || '—'}`
    }

    let sent = 0, failed = 0
    for (const a of avisos) {
      if (!a.email) continue
      const tom = tomPorDias(a.dias)
      const html = htmlCobranca({
        orgName: a.org_name, cliente: a.cliente, paymentInfo: a.payment_info, tom,
        titulos: [{ descricao: a.descricao, valor: a.valor, vencimento: a.vencimento, dias: a.dias }],
      })
      const r = await sendMail({
        to: a.email,
        subject: `${assuntoCobranca(tom, a.dias)} — ${a.org_name}`,
        html,
      })
      if (r.error) { failed++; continue }
      sent++
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).rpc('mark_cobranca_aviso', { p_lancamento_id: a.lancamento_id, p_bucket: a.bucket })
    }
    return `${sent} enviada(s)${failed ? `, ${failed} falhou(aram)` : ''}`
  },
}
