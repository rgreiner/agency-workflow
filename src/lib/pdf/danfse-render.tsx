import 'server-only'
import { renderToBuffer } from '@react-pdf/renderer'
import QRCode from 'qrcode'
import { createClient } from '@/lib/supabase/server'
import { desempacotar } from '@/lib/fiscal/dps'
import { lerDanfse, linkConsulta } from './danfse-data'
import { DanfseDoc } from './DanfseDoc'

/**
 * DANFSe de uma nota emitida, renderizado na hora.
 *
 * Mora aqui, e não só na rota, porque dois caminhos precisam do mesmo PDF: o
 * download na tela e o anexo do e-mail ao cliente. Gerar a cada chamada é
 * decisão, não descuido — a nota pode ter sido cancelada ou substituída depois
 * de emitida, e o PDF tem que sair com a marca d'água do estado atual.
 *
 * Lê com o token de quem chamou: quem não enxerga a org pela RLS não baixa a
 * nota, nem pela tela nem pelo e-mail.
 */
export interface NotaParaPdf {
  xml: string
  baseNome: string
  cancelada: boolean
  motivoCancelamento: string | null
  substituidaPor: string | null
  chave: string
}

export async function lerNotaParaPdf(notaId: string): Promise<NotaParaPdf | null> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: nota } = await (supabase as any).from('nota_fiscal')
    .select('numero, chave, status, xml_gz_b64, cancel_motivo, substituida_por')
    .eq('id', notaId).maybeSingle()
  if (!nota?.xml_gz_b64) return null

  let xml: string
  try { xml = desempacotar(nota.xml_gz_b64) } catch { return null }

  return {
    xml,
    baseNome: `NFS-e ${nota.numero ?? nota.chave}`.replace(/[/\\]/g, '-'),
    cancelada: nota.status === 'cancelada',
    motivoCancelamento: nota.cancel_motivo ?? null,
    substituidaPor: nota.substituida_por ?? null,
    chave: nota.chave ?? '',
  }
}

/** PDF do DANFSe a partir do que `lerNotaParaPdf` devolveu. */
export async function danfsePdf(n: NotaParaPdf): Promise<Buffer> {
  const d = lerDanfse(n.xml, {
    cancelada: n.cancelada,
    motivoCancelamento: n.motivoCancelamento,
    substituidaPor: n.substituidaPor,
  })
  const qr = await QRCode.toDataURL(linkConsulta(d.chave || n.chave), { margin: 0, width: 240 })
  return renderToBuffer(<DanfseDoc d={d} qrDataUrl={qr} />)
}
