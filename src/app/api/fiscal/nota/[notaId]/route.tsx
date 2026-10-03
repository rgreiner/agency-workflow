// DANFSe e XML da NFS-e emitida.
//
// `?xml=1` devolve o XML autorizado — o documento fiscal de verdade, o que a
// contabilidade arquiva. Sem parâmetro devolve o DANFSe em PDF, que é o que vai
// para o cliente junto do boleto.
//
// A renderização mora em lib/pdf/danfse-render, compartilhada com o anexo do
// e-mail de faturamento: o cliente tem que receber exatamente o mesmo PDF que
// aparece aqui.

import { NextRequest } from 'next/server'
import { getUsuario } from '@/lib/auth/server'
import { lerNotaParaPdf, danfsePdf } from '@/lib/pdf/danfse-render'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ notaId: string }> }) {
  const { notaId } = await params
  const user = await getUsuario()
  if (!user) return new Response('Não autenticado', { status: 401 })

  const nota = await lerNotaParaPdf(notaId)
  if (!nota) return new Response('Nota não encontrada ou sem XML guardado', { status: 404 })

  if (req.nextUrl.searchParams.has('xml')) {
    return new Response(nota.xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${ascii(nota.baseNome)}.xml"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  const pdf = await danfsePdf(nota)
  const inline = req.nextUrl.searchParams.has('inline')
  const nome = `${nota.baseNome}.pdf`
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
