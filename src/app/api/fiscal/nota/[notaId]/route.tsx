// DANFSe e XML da NFS-e emitida.
//
// `?xml=1` devolve o XML autorizado — o documento fiscal de verdade, o que a
// contabilidade arquiva. Sem parâmetro devolve o DANFSe em PDF, que é o que vai
// para o cliente junto do boleto.
//
// Gerado a cada chamada de propósito: a nota pode ter sido cancelada ou
// substituída depois de emitida, e o PDF precisa sair com a marca d'água certa.
// PDF congelado em arquivo mentiria sobre o estado atual da nota.

import { NextRequest } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import QRCode from 'qrcode'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { desempacotar } from '@/lib/fiscal/dps'
import { lerDanfse, linkConsulta } from '@/lib/pdf/danfse-data'
import { DanfseDoc } from '@/lib/pdf/DanfseDoc'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ notaId: string }> }) {
  const { notaId } = await params
  const user = await getUsuario()
  if (!user) return new Response('Não autenticado', { status: 401 })

  const supabase = await createClient()
  // Lido com o token do usuário: quem não enxerga a org pela RLS (fin_can) não
  // baixa a nota.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: nota } = await (supabase as any).from('nota_fiscal')
    .select('numero, chave, status, xml_gz_b64, cancel_motivo, substituida_por')
    .eq('id', notaId).maybeSingle()
  if (!nota) return new Response('Nota não encontrada', { status: 404 })
  if (!nota.xml_gz_b64) return new Response('XML não guardado para esta nota', { status: 404 })

  let xml: string
  try { xml = desempacotar(nota.xml_gz_b64) } catch { return new Response('XML ilegível', { status: 500 }) }

  const baseNome = `NFS-e ${nota.numero ?? nota.chave}`.replace(/[/\\]/g, '-')

  if (req.nextUrl.searchParams.has('xml')) {
    return new Response(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${ascii(baseNome)}.xml"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  const d = lerDanfse(xml, {
    cancelada: nota.status === 'cancelada',
    motivoCancelamento: nota.cancel_motivo,
    substituidaPor: nota.substituida_por,
  })
  const qr = await QRCode.toDataURL(linkConsulta(d.chave || nota.chave), { margin: 0, width: 240 })
  const pdf = await renderToBuffer(<DanfseDoc d={d} qrDataUrl={qr} />)

  const inline = req.nextUrl.searchParams.has('inline')
  const nome = `${baseNome}.pdf`
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition':
        `${inline ? 'inline' : 'attachment'}; filename="${ascii(nome)}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
      'Cache-Control': 'no-store',
    },
  })
}

const ascii = (n: string) => n.replace(/[^\x20-\x7E]/g, '_')
