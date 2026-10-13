// PDF do orçamento para o CLIENTE (mig. 342): o mesmo documento que a agência
// baixa (lib/pdf/ProducaoDoc), montado com o pacote que a RPC do portal entrega
// depois de conferir que o orçamento é do cliente da sessão e está publicado.

import { NextRequest } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { sessaoPortal } from '@/lib/auth/portal'
import { createPortalClient } from '@/lib/supabase/portal'
import { loadProducaoDoc, clienteDePacote } from '@/lib/pdf/producao-data'
import { ProducaoDoc } from '@/lib/pdf/ProducaoDoc'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ producaoId: string }> },
) {
  if (!(await sessaoPortal())) return new Response('Sessão expirada', { status: 401 })
  const { producaoId } = await params

  const supabase = await createPortalClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pacote, error } = await (supabase as any).rpc('portal_orcamento_doc', { p_id: producaoId })
  if (error || !pacote) return new Response('Orçamento indisponível', { status: 404 })

  const dados = await loadProducaoDoc(clienteDePacote(pacote), String(pacote.org_id), producaoId)
  if (!dados) return new Response('Orçamento indisponível', { status: 404 })

  const pdf = await renderToBuffer(<ProducaoDoc d={dados} />)
  const inline = req.nextUrl.searchParams.has('inline')
  const nome = `${dados.nomeArquivo || 'orcamento'}.pdf`.replace(/[/\\]/g, '-')
  const asciiSafe = nome.replace(/[^\x20-\x7E]/g, '_')

  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition':
        `${inline ? 'inline' : 'attachment'}; filename="${asciiSafe}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
      'Cache-Control': 'no-store',
    },
  })
}
