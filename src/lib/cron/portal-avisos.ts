import 'server-only'
import { emailLayout } from '@/lib/email/layout'
import { sendMail } from '@/lib/email/send'
import type { CronJob } from './jobs'

/**
 * Aviso diário ao CLIENTE (mig. 342): o que chegou para ele decidir desde o
 * último aviso — trabalho em aprovação, pendência de informação e orçamento
 * publicado. Sem novidade, sem e-mail. Sem isto o portal não tinha uso: o
 * cliente não sabia que havia algo esperando por ele.
 */
interface Item { tipo: 'aprovar' | 'responder' | 'orcamento'; titulo: string; campanha: string | null; prazo: string | null }
interface Contato { id: string; nome: string; email: string; cliente: string; agencia: string; itens: Item[] }

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://flow.oneaone.com.br'
const esc = (s: string | null) => (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const ROTULO: Record<Item['tipo'], string> = { aprovar: 'Aprovar', responder: 'Responder', orcamento: 'Orçamento' }

function html(c: Contato): string {
  const primeiro = c.nome.trim().split(' ')[0]
  const linhas = c.itens.map(i => {
    const [, m, d] = (i.prazo ?? '').split('-')
    const meta = [esc(i.campanha), i.prazo ? `entrega ${d}/${m}` : ''].filter(Boolean).join(' · ')
    return `<div style="padding:11px 13px;border:1px solid #eef0f2;border-radius:10px;margin-bottom:8px;">
      <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#c2410c;">${ROTULO[i.tipo]}</span><br>
      <span style="font-weight:600;font-size:14px;color:#111827;">${esc(i.titulo)}</span>
      ${meta ? `<br><span style="font-size:12px;color:#6b7280;">${meta}</span>` : ''}
    </div>`
  }).join('')
  return emailLayout({
    heading: c.itens.length === 1 ? 'Uma decisão esperando por você' : `${c.itens.length} decisões esperando por você`,
    bodyHtml: `<p>Olá, ${esc(primeiro)}!</p>
<p>Chegou coisa nova no painel de <b>${esc(c.cliente)}</b> para você ver:</p>
${linhas}`,
    cta: { label: 'Abrir o painel', url: `${BASE}/portal` },
    footerNote: `Você recebe este aviso porque tem acesso ao painel da ${esc(c.agencia)}. Para parar de receber, fale com o seu atendimento.`,
  })
}

export const portalAvisosJob: CronJob = {
  name: 'portal-avisos',
  dailyAfterHour: 9,
  weekdaysOnly: true,
  run: async ({ supabase, dry, only }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const { data, error } = await sb.rpc('portal_avisos_cliente')
    if (error) throw new Error(error.message)
    let contatos = (data ?? []) as Contato[]
    if (only) contatos = contatos.filter(c => c.email.toLowerCase() === only.toLowerCase())
    if (dry) return `${contatos.length} contato(s) receberiam: ${contatos.map(c => `${c.email} (${c.itens.length})`).join(', ') || '—'}`

    const enviados: string[] = []
    let falhas = 0
    for (const c of contatos) {
      const assunto = `${c.cliente}: ${c.itens.length === 1 ? '1 decisão' : `${c.itens.length} decisões`} no seu painel`
      const r = await sendMail({ to: c.email, subject: assunto, html: html(c) })
      if (r.error) falhas++; else enviados.push(c.id)
    }
    if (enviados.length) {
      const { error: e2 } = await sb.rpc('portal_avisos_marcar', { p_ids: enviados })
      if (e2) throw new Error(e2.message)
    }
    return `${enviados.length} aviso(s) enviado(s)${falhas ? `, ${falhas} falhou(aram)` : ''}`
  },
}
