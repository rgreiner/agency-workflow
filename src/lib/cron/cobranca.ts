import 'server-only'
import { emailLayout } from '@/lib/email/layout'
import { sendMail } from '@/lib/email/send'
import type { CronJob } from './jobs'

interface Aviso {
  lancamento_id: string; bucket: 'd-3' | 'd0' | 'd+3'
  org_slug: string; org_name: string; cliente: string; email: string
  descricao: string; valor: number; vencimento: string; payment_info: string
}

const esc = (s: string) => (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const brl = (n: number) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dt = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}` }
const TITULO: Record<Aviso['bucket'], string> = { 'd-3': 'Vencimento em 3 dias', 'd0': 'Vence hoje', 'd+3': 'Pagamento em atraso' }
const INTRO: Record<Aviso['bucket'], string> = {
  'd-3': 'passando pra lembrar que a cobrança abaixo vence em 3 dias.',
  'd0': 'a cobrança abaixo vence hoje.',
  'd+3': 'identificamos que a cobrança abaixo está em atraso.',
}

function buildHtml(a: Aviso): string {
  const body =
    `<p style="margin:0 0 12px;">Olá, ${esc(a.cliente)} — ${INTRO[a.bucket]}</p>` +
    `<table style="width:100%;border-collapse:collapse;margin:6px 0 14px;">
      <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Descrição</td><td style="padding:8px 0;text-align:right;font-weight:600;">${esc(a.descricao)}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;border-top:1px solid #eef0f2;">Valor</td><td style="padding:8px 0;text-align:right;font-weight:700;border-top:1px solid #eef0f2;">${brl(a.valor)}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;border-top:1px solid #eef0f2;">Vencimento</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #eef0f2;">${dt(a.vencimento)}</td></tr>
    </table>` +
    (a.payment_info ? `<p style="font-size:13px;color:#374151;white-space:pre-line;background:#f6f6f4;border-radius:10px;padding:12px 14px;">${esc(a.payment_info)}</p>` : '') +
    `<p style="margin:14px 0 0;color:#6b7280;font-size:13px;">Se o pagamento já foi feito, desconsidere este aviso. Atenciosamente,<br><strong style="color:#111827;">${esc(a.org_name)}</strong></p>`
  return emailLayout({ heading: TITULO[a.bucket], bodyHtml: body, footerNote: `Aviso de cobrança · ${esc(a.org_name)}` })
}

/** Cobrança: e-mail ao cliente em D-3 / D0 / D+3 do vencimento (recebíveis em aberto),
 *  só para clientes com cobrança automática ligada. 1x/dia (seg–sex, 9h BRT). */
export const cobrancaJob: CronJob = {
  name: 'cobranca',
  dailyAfterHour: 9,
  weekdaysOnly: true,
  run: async ({ supabase, dry, only }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any).rpc('cobranca_payload')
    let avisos = (data ?? []) as Aviso[]
    if (only) avisos = avisos.filter(a => a.email?.toLowerCase() === only.toLowerCase())
    if (dry) return `${avisos.length} cobrança(s): ${avisos.map(a => `${a.cliente}/${a.bucket}`).join(', ') || '—'}`
    let sent = 0, failed = 0
    for (const a of avisos) {
      if (!a.email) continue
      const r = await sendMail({ to: a.email, subject: `${TITULO[a.bucket]} — ${a.org_name}`, html: buildHtml(a) })
      if (r.error) { failed++; continue }
      sent++
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).rpc('mark_cobranca_aviso', { p_lancamento_id: a.lancamento_id, p_bucket: a.bucket })
    }
    return `${sent} enviada(s)${failed ? `, ${failed} falhou(aram)` : ''}`
  },
}
