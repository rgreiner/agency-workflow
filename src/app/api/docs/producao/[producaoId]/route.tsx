// PDF dos documentos de Produção (Fee, Proposta, Pedido, Orçamento), no servidor.
// Mesmo padrão da Autorização de Mídia: o botão baixa direto e `?inline=1` devolve
// o mesmo PDF para a tela de visualização — uma definição só (lib/pdf/ProducaoDoc).

import { NextRequest } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { loadProducaoDoc } from '@/lib/pdf/producao-data'
import { ProducaoDoc } from '@/lib/pdf/ProducaoDoc'

// Gera a cada chamada: o documento muda enquanto não é faturado.
export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ producaoId: string }> },
) {
  const { producaoId } = await params
  const user = await getUsuario()
  if (!user) return new Response('Não autenticado', { status: 401 })

  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // Lido com o token do usuário: quem não enxerga a org pela RLS não baixa o PDF.
  const { data: prod } = await sb.from('producao').select('org_id').eq('id', producaoId).maybeSingle()
  if (!prod) return new Response('Documento não encontrado', { status: 404 })

  const dados = await loadProducaoDoc(sb, prod.org_id as string, producaoId)
  if (!dados) return new Response('Documento não encontrado', { status: 404 })

  const pdf = await renderToBuffer(<ProducaoDoc d={dados} />)

  const inline = req.nextUrl.searchParams.has('inline')
  const nome = `${dados.nomeArquivo || 'documento'}.pdf`.replace(/[/\\]/g, '-')
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
