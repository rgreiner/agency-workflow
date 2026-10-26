import 'server-only'
import { sendMail } from '@/lib/email/send'
import { assuntoCotacao, htmlCotacao, remetenteCotacao } from '@/lib/email/cotacao'
import type { CotacaoItem } from '@/lib/cotacao'
import type { CronJob } from './jobs'

/**
 * Lembrete diário da cotação (mig. 372): todo dia útil, às 9h, até o prazo, quem
 * foi convidado e não respondeu nem recusou recebe o link de novo. No dia do prazo
 * o assunto vira "Último dia". As regras de quem entra moram na função
 * `cotacao_lembretes_pendentes` (só o cron executa).
 *
 * Pedido do Rafael em 26/10/2026, com a adesão medida: 5 respostas em 40 convites.
 */
interface Pendente {
  id: string; cotacao_id: string; token: string; email: string
  fornecedor: string; agencia: string; titulo: string; cliente: string | null; comissao: number | string | null
  prazo: string | null; itens: CotacaoItem[]; ultimo_dia: boolean; lembretes: number
}

export const cotacaoLembretesJob: CronJob = {
  name: 'cotacao-lembretes',
  dailyAfterHour: 9,
  weekdaysOnly: true,
  run: async ({ supabase, dry, only }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const { data, error } = await sb.rpc('cotacao_lembretes_pendentes')
    if (error) throw new Error(error.message)
    let lista = (data ?? []) as Pendente[]
    if (only) lista = lista.filter(p => p.email.toLowerCase() === only.toLowerCase())

    // UM e-mail por endereço e cotação: cadastros diferentes com o mesmo e-mail
    // (medido: 4 fornecedores com o do Diego da ADI) não recebem o mesmo aviso 4x.
    const grupos = new Map<string, Pendente[]>()
    for (const p of lista) {
      const k = `${p.cotacao_id}|${p.email.trim().toLowerCase()}`
      grupos.set(k, [...(grupos.get(k) ?? []), p])
    }
    if (dry) return `${grupos.size} lembrete(s) sairiam: ${[...grupos.values()].map(g => `${g[0].email} (${g[0].titulo}${g[0].ultimo_dia ? ', último dia' : ''})`).join(', ') || '—'}`

    const ids: string[] = [], emails: string[] = []
    let falhas = 0
    for (const g of grupos.values()) {
      const p = g[0]
      const dados = {
        fornecedor: p.fornecedor, agencia: p.agencia, titulo: p.titulo, cliente: p.cliente ?? '',
        comissao: Number(p.comissao ?? 0) || 0, itens: p.itens ?? [], prazo: p.prazo, token: p.token,
      }
      const modo = p.ultimo_dia ? 'ultimo_dia' : 'lembrete'
      const r = await sendMail({ from: remetenteCotacao(p.agencia), to: p.email, subject: assuntoCotacao(dados, modo), html: htmlCotacao(dados, modo) })
      if (r.error) { falhas++; continue }
      // Marca o grupo todo: os outros convites do mesmo e-mail também foram "lembrados".
      for (const x of g) { ids.push(x.id); emails.push(x.email) }
    }
    if (ids.length) {
      const { error: e2 } = await sb.rpc('cotacao_lembretes_marcar', { p_ids: ids, p_emails: emails })
      if (e2) throw new Error(e2.message)
    }
    return `${grupos.size - falhas} lembrete(s) enviado(s) (${ids.length} convite(s))${falhas ? `, ${falhas} falhou(aram)` : ''}`
  },
}
