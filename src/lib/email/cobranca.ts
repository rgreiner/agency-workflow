import 'server-only'
import { emailLayout } from './layout'

/**
 * E-mail de cobrança — usado pela régua automática (cron) E pelo "Cobrar agora"
 * da tela de Inadimplentes. Um template só: o que muda entre os dois é quem
 * dispara, não o que o cliente lê.
 *
 * O tom escalona com o atraso (`dias`), mas nunca ameaça: cliente em atraso de
 * 90 dias costuma ser cliente ativo, e o e-mail vai do financeiro da agência.
 * Quem decide falar grosso é o Rafael, no telefone — não um cron.
 */
export interface TituloCobranca {
  descricao: string
  valor: number
  vencimento: string   // YYYY-MM-DD
  dias: number         // negativo = ainda vai vencer; 0 = hoje; positivo = atraso
}

export type TomCobranca = 'previa' | 'hoje' | 'atraso' | 'atraso_longo' | 'formal'

const esc = (s: string) => (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const brl = (n: number) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dt = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}` }

/** Degrau da régua → tom. O corte em 45 dias é onde a cobrança deixa de ser
 *  lembrete e vira pendência formal (é quando o Rafael já ligou). */
export function tomPorDias(dias: number): TomCobranca {
  if (dias < 0) return 'previa'
  if (dias === 0) return 'hoje'
  if (dias <= 15) return 'atraso'
  if (dias <= 45) return 'atraso_longo'
  return 'formal'
}

export function assuntoCobranca(tom: TomCobranca, dias: number): string {
  switch (tom) {
    case 'previa': return `Vencimento em ${Math.abs(dias)} dia${Math.abs(dias) > 1 ? 's' : ''}`
    case 'hoje': return 'Vence hoje'
    case 'atraso': return 'Pagamento em atraso'
    case 'atraso_longo': return `Pagamento em atraso há ${dias} dias`
    case 'formal': return 'Pendência financeira em aberto'
  }
}

function intro(tom: TomCobranca, dias: number, varios: boolean): string {
  const isto = varios ? 'as cobranças abaixo' : 'a cobrança abaixo'
  switch (tom) {
    case 'previa':
      return `passando para lembrar que ${isto} vence${varios ? 'm' : ''} em ${Math.abs(dias)} dia${Math.abs(dias) > 1 ? 's' : ''}.`
    case 'hoje':
      return `${isto} vence${varios ? 'm' : ''} hoje.`
    case 'atraso':
      return `identificamos que ${isto} está${varios ? 'ão' : ''} em atraso.`
    case 'atraso_longo':
      return `${isto} segue${varios ? 'm' : ''} em aberto — ${varios ? 'o mais antigo está' : 'já são'} ${dias} dias após o vencimento.`
    case 'formal':
      return `${isto} permanece${varios ? 'm' : ''} sem baixa no nosso financeiro, ${varios ? 'a mais antiga' : ''} com ${dias} dias de atraso. Se houver alguma divergência no documento, responda este e-mail que ajustamos.`
  }
}

export function htmlCobranca(o: {
  orgName: string
  cliente: string
  titulos: TituloCobranca[]
  paymentInfo: string
  /** Sem tom explícito, deduz do título mais atrasado. */
  tom?: TomCobranca
}): string {
  const varios = o.titulos.length > 1
  const dias = Math.max(...o.titulos.map(t => t.dias))
  const tom = o.tom ?? tomPorDias(dias)
  const total = o.titulos.reduce((s, t) => s + Number(t.valor || 0), 0)

  const linhas = o.titulos.map(t => `
    <tr>
      <td style="padding:9px 0;border-top:1px solid #eef0f2;">
        <span style="color:#111827;font-size:14px;">${esc(t.descricao)}</span><br>
        <span style="color:#9ca3af;font-size:12px;">venc. ${dt(t.vencimento)}${t.dias > 0 ? ` · ${t.dias} dia${t.dias > 1 ? 's' : ''} em atraso` : ''}</span>
      </td>
      <td style="padding:9px 0;text-align:right;font-weight:600;border-top:1px solid #eef0f2;white-space:nowrap;">${brl(t.valor)}</td>
    </tr>`).join('')

  const body =
    `<p style="margin:0 0 12px;">Olá, ${esc(o.cliente)} — ${intro(tom, dias, varios)}</p>` +
    `<table style="width:100%;border-collapse:collapse;margin:6px 0 14px;">${linhas}` +
    (varios
      ? `<tr><td style="padding:10px 0;border-top:2px solid #e5e7eb;color:#6b7280;font-size:13px;">Total em aberto</td>
           <td style="padding:10px 0;text-align:right;font-weight:700;border-top:2px solid #e5e7eb;white-space:nowrap;">${brl(total)}</td></tr>`
      : '') +
    `</table>` +
    (o.paymentInfo
      ? `<p style="font-size:13px;color:#374151;white-space:pre-line;background:#f6f6f4;border-radius:10px;padding:12px 14px;margin:0 0 4px;">${esc(o.paymentInfo)}</p>`
      : '') +
    `<p style="margin:14px 0 0;color:#6b7280;font-size:13px;">Se o pagamento já foi feito, desconsidere este aviso. Atenciosamente,<br><strong style="color:#111827;">${esc(o.orgName)}</strong></p>`

  return emailLayout({
    heading: assuntoCobranca(tom, dias),
    bodyHtml: body,
    footerNote: `Aviso de cobrança · ${esc(o.orgName)}`,
  })
}
