import 'server-only'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { emailLayout } from './layout'
import type { MailAttachment } from './send'
import type { Anexo } from '@/app/actions/financeiro'

function uploadRoot(): string {
  return process.env.UPLOAD_DIR || '/app/uploads'
}

/**
 * Lê os anexos da conferência (NF/Boleto/comprovantes) pra mandar junto no e-mail.
 * O `Anexo` guarda a URL pública (…/uploads/<bucket>/<rel>); derivamos o caminho
 * no volume e lemos o arquivo. Ignora anexo que não resolve (não derruba o envio)
 * e barra traversal / prefixo privado.
 */
export async function lerAnexosFaturamento(anexos: Anexo[]): Promise<MailAttachment[]> {
  const root = path.resolve(uploadRoot())
  const out: MailAttachment[] = []
  for (const a of anexos ?? []) {
    const i = a.url?.indexOf('/uploads/')
    if (i === undefined || i < 0) continue
    const rel = a.url.slice(i + '/uploads/'.length)
    if (!rel || rel.includes('..') || rel.startsWith('rh-privado/')) continue
    const abs = path.resolve(root, rel)
    if (abs !== root && !abs.startsWith(root + path.sep)) continue
    try {
      out.push({ filename: a.nome || rel.split('/').pop() || 'documento', content: await readFile(abs) })
    } catch {
      /* anexo sumiu do volume — segue sem ele */
    }
  }
  return out
}

const brl = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n || 0)
const dataBR = (iso?: string | null) =>
  iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—'

export interface FaturamentoEmailData {
  orgName: string
  clienteNome: string
  docNumero: string
  titulo: string
  valorTotal: number
  parcelas: { vencimento?: string | null; valor: number }[]
  mensagem?: string
  anexosNomes: string[]
}

/** Monta o HTML do e-mail de faturamento ao cliente (template padrão do Flow). */
export function htmlFaturamento(d: FaturamentoEmailData): string {
  const linhas = d.parcelas.length > 1
    ? `<table style="width:100%;border-collapse:collapse;margin:8px 0 4px;font-size:14px">
         <tr style="color:#6b7280;text-align:left">
           <th style="padding:4px 0;font-weight:600">Parcela</th>
           <th style="padding:4px 0;font-weight:600">Vencimento</th>
           <th style="padding:4px 0;font-weight:600;text-align:right">Valor</th>
         </tr>
         ${d.parcelas.map((p, i) => `<tr>
           <td style="padding:4px 0;border-top:1px solid #eee">${i + 1}/${d.parcelas.length}</td>
           <td style="padding:4px 0;border-top:1px solid #eee">${dataBR(p.vencimento)}</td>
           <td style="padding:4px 0;border-top:1px solid #eee;text-align:right">${brl(p.valor)}</td>
         </tr>`).join('')}
       </table>`
    : `<p style="margin:6px 0"><b>Vencimento:</b> ${dataBR(d.parcelas[0]?.vencimento)}</p>`

  const anexosLinha = d.anexosNomes.length
    ? `<p style="margin:12px 0 0;color:#6b7280;font-size:13px">📎 Anexos: ${d.anexosNomes.join(' · ')}</p>`
    : ''

  return emailLayout({
    brand: d.orgName,
    heading: `Faturamento ${d.docNumero}`,
    bodyHtml: `
      <p>Olá!</p>
      ${d.mensagem ? `<p>${d.mensagem.replace(/\n/g, '<br>')}</p>` : ''}
      <p>Segue o faturamento referente a <b>${d.titulo}</b> (${d.docNumero}).</p>
      <p style="margin:10px 0"><b>Valor total:</b> ${brl(d.valorTotal)}</p>
      ${linhas}
      ${anexosLinha}
      <p style="margin-top:16px">Qualquer dúvida, é só responder este e-mail.</p>
    `,
    footerNote: `${d.orgName} · Financeiro`,
  })
}
