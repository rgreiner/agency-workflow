import 'server-only'
import { emailLayout } from '@/lib/email/layout'
import { sendMail } from '@/lib/email/send'
import type { CronJob } from './jobs'

interface DigestTask { id: string; title: string; due: string; campaign: string | null; cliente: string | null }
interface DigestUser { email: string; name: string | null; org_slug: string; atrasadas: DigestTask[]; hoje: DigestTask[]; proximas: DigestTask[] }

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://flow.oneaone.com.br'
const esc = (s: string | null) => (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmtDue = (iso: string) => { const [, m, d] = iso.split('-'); return `${d}/${m}` }

function section(title: string, color: string, tasks: DigestTask[], orgSlug: string, showDate: boolean): string {
  if (!tasks.length) return ''
  const rows = tasks.map(t => `
    <a href="${BASE}/${orgSlug}/j/${t.id}" style="display:block;text-decoration:none;color:#111827;padding:11px 13px;border:1px solid #eef0f2;border-radius:10px;margin-bottom:8px;">
      <span style="font-weight:600;font-size:14px;color:#111827;">${esc(t.title)}</span><br>
      <span style="font-size:12px;color:#6b7280;">${[esc(t.cliente), esc(t.campaign)].filter(Boolean).join(' · ')}${showDate ? ` — ${fmtDue(t.due)}` : ''}</span>
    </a>`).join('')
  return `<div style="margin-top:22px;">
    <p style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:${color};margin:0 0 10px;">${title} · ${tasks.length}</p>
    ${rows}
  </div>`
}

function buildDigestHtml(u: DigestUser): string {
  const primeiro = (u.name ?? '').trim().split(' ')[0]
  const body =
    `<p style="margin:0 0 4px;">${primeiro ? `Bom dia, ${esc(primeiro)}!` : 'Bom dia!'} Aqui está o seu dia no Flow.</p>` +
    section('⚠️ O que ficou atrasado', '#dc2626', u.atrasadas, u.org_slug, true) +
    section('🎯 O que fazer hoje', '#ea580c', u.hoje, u.org_slug, false) +
    section('🗓️ Próximas datas', '#6b7280', u.proximas, u.org_slug, true)
  return emailLayout({ heading: 'Seu resumo do dia', bodyHtml: body, footerNote: 'Resumo diário do Flow · desligue em Meu Perfil' })
}

/** Job do resumo diário — 8h30 (BRT). 1 e-mail por pessoa com pendências; quem não tem, não recebe. */
export const digestJob: CronJob = {
  name: 'digest',
  dailyAfterHour: 8,
  dailyAfterMinute: 30,
  weekdaysOnly: true,   // não manda sábado/domingo
  run: async ({ supabase, dry, only }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any).rpc('digest_payload')
    let users = (data ?? []) as DigestUser[]
    if (only) users = users.filter(u => u.email?.toLowerCase() === only.toLowerCase())  // teste p/ 1 pessoa
    if (dry) return `${users.length} pessoa(s) receberiam: ${users.map(u => u.email).join(', ') || '—'}`
    let sent = 0, failed = 0
    for (const u of users) {
      if (!u.email) continue
      const r = await sendMail({ to: u.email, subject: '☀️ Seu resumo do dia — Flow', html: buildDigestHtml(u) })
      if (r.error) failed++; else sent++
    }
    return `${sent} enviado${sent !== 1 ? 's' : ''}${failed ? `, ${failed} falhou(aram)` : ''}`
  },
}
