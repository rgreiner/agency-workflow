import 'server-only'
import { bytesDeUpload } from '@/lib/uploads-volume'
import type { MailAttachment } from './send'

/**
 * Boletos dos títulos cobrados, para irem anexos ao e-mail.
 *
 * O cliente que recebe "não identificamos o pagamento" e precisa procurar o
 * boleto no e-mail de três semanas atrás tem um motivo a mais para adiar. Ele
 * vai junto.
 *
 * Só o que está marcado como `Boleto` no lançamento — NF e comprovante ficam de
 * fora: a cobrança pede o documento de pagar, não o pacote inteiro.
 *
 * Arquivo que sumiu do volume não derruba a cobrança: o e-mail sai sem anexo,
 * que é melhor que não sair. Cobrança que falha em silêncio é dinheiro parado.
 */
export async function boletosDosLancamentos(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  orgId: string,
  lancamentoIds: string[],
): Promise<MailAttachment[]> {
  if (!lancamentoIds.length) return []

  const { data } = await sb.from('lancamentos')
    .select('id, anexos').eq('org_id', orgId).in('id', lancamentoIds.slice(0, 50))

  const anexos: MailAttachment[] = []
  const vistos = new Set<string>()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const l of (data ?? []) as any[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const a of ((l.anexos ?? []) as any[])) {
      if (a?.tipo !== 'Boleto' || !a?.url) continue
      if (vistos.has(a.url)) continue   // o mesmo boleto pode cobrir duas parcelas
      vistos.add(a.url)

      const bytes = await bytesDeUpload(a.url)
      if (!bytes) continue

      const bruto = String(a.nome ?? '').trim()
      const nome = /\.pdf$/i.test(bruto)
        ? bruto
        : `Boleto${a.numero ? ` ${a.numero}` : ''}.pdf`
      anexos.push({ filename: nome.replace(/[/\\]/g, '-'), content: bytes })
    }
  }
  return anexos
}
