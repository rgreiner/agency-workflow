import 'server-only'
import { emailLayout } from './layout'
import { remetenteDominio } from './send'
import { urlCotacao, type CotacaoItem } from '@/lib/cotacao'

/**
 * E-mail da cotação ao fornecedor — o mesmo texto no convite e no lembrete diário
 * (mig. 372), só muda o topo. O fornecedor que recebe o lembrete precisa de tudo
 * de novo (itens, cliente, comissão): é comum ele ter perdido o primeiro e-mail.
 */
export interface EmailCotacao {
  fornecedor: string; agencia: string; titulo: string; cliente: string; comissao: number
  itens: CotacaoItem[]; prazo: string | null; token: string
}
export type ModoEmailCotacao = 'convite' | 'lembrete' | 'ultimo_dia'

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const dataBR = (d: string | null) => (d ? d.split('-').reverse().join('/') : '')

export function remetenteCotacao(agencia: string): string | undefined {
  const dominio = remetenteDominio()
  return dominio ? `${agencia} <flow@${dominio}>` : undefined
}

export function assuntoCotacao(o: EmailCotacao, modo: ModoEmailCotacao): string {
  if (modo === 'ultimo_dia') return `Último dia: cotação ${o.titulo}`
  if (modo === 'lembrete') return `Lembrete: cotação ${o.titulo}${o.prazo ? ` — até ${dataBR(o.prazo)}` : ''}`
  return `Pedido de cotação — ${o.titulo}`
}

export function htmlCotacao(o: EmailCotacao, modo: ModoEmailCotacao): string {
  const lista = o.itens.map(it =>
    `<li style="margin-bottom:6px"><b>${esc(it.nome)}</b>${it.faixas.length && !(it.faixas.length === 1 && it.faixas[0] === 1)
      ? ` — ${it.faixas.map(n => n.toLocaleString('pt-BR')).join(' / ')} un.` : ''}</li>`).join('')
  const abertura = modo === 'convite'
    ? `<p>A <b>${esc(o.agencia)}</b> está cotando <b>${esc(o.titulo)}</b>${o.cliente ? ` para o cliente <b>${esc(o.cliente)}</b>` : ''} e gostaria da sua proposta${o.prazo ? ` até <b>${dataBR(o.prazo)}</b>` : ''}.</p>`
    : modo === 'ultimo_dia'
      ? `<p>Hoje é o <b>último dia</b> para enviar a sua proposta para <b>${esc(o.titulo)}</b>${o.cliente ? ` (cliente <b>${esc(o.cliente)}</b>)` : ''}. Ainda não recebemos a sua.</p>`
      : `<p>Ainda não recebemos a sua proposta para <b>${esc(o.titulo)}</b>${o.cliente ? ` (cliente <b>${esc(o.cliente)}</b>)` : ''}${o.prazo ? `. O prazo vai até <b>${dataBR(o.prazo)}</b>` : ''}.</p>`
  return emailLayout({
    brand: o.agencia,
    heading: modo === 'convite' ? 'Pedido de cotação' : modo === 'ultimo_dia' ? 'Último dia para a sua proposta' : 'Lembrete de cotação',
    bodyHtml: `<p>Olá${o.fornecedor ? `, ${esc(o.fornecedor)}` : ''}!</p>
${abertura}
<ul style="padding-left:18px;margin:16px 0">${lista}</ul>
<p>${o.comissao > 0
  ? `Comissão da agência: <b>${o.comissao.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</b> sobre o valor do pedido.`
  : 'Sem comissão da agência neste pedido.'}</p>
<p>No link abaixo você vê os detalhes e os anexos e preenche os valores — por unidade ou total. Se preferir, anexe o seu orçamento em PDF. Se não for cotar desta vez, dá para avisar pelo mesmo link e os lembretes param.</p>`,
    cta: { label: 'Enviar minha proposta', url: urlCotacao(o.token) },
    footerNote: 'Este link é exclusivo da sua empresa. Dá para corrigir a proposta pelo mesmo link até o prazo.',
  })
}
