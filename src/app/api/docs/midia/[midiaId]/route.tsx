// PDF da Autorização de Mídia, gerado no servidor.
//
// Substitui o antigo window.print(): o botão baixa o arquivo direto, sem abrir
// aba nem caixa de impressão. `?inline=1` devolve o mesmo PDF para ser exibido
// na tela de visualização — assim o documento tem UMA definição só
// (lib/pdf/MidiaDoc), e o que se vê é exatamente o que se envia.

import { NextRequest } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { loadMidiaDoc } from '@/lib/pdf/midia-data'
import { MidiaDoc } from '@/lib/pdf/MidiaDoc'

// Gera a cada chamada: o documento muda enquanto não é faturado.
export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ midiaId: string }> },
) {
  const { midiaId } = await params
  const user = await getUsuario()
  if (!user) return new Response('Não autenticado', { status: 401 })

  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // A mídia é lida com o token do usuário: quem não enxerga a org pela RLS
  // também não baixa o PDF dela.
  const { data: midia } = await sb.from('midias').select('org_id').eq('id', midiaId).maybeSingle()
  if (!midia) return new Response('Documento não encontrado', { status: 404 })

  const dados = await loadMidiaDoc(sb, midia.org_id as string, midiaId)
  if (!dados) return new Response('Documento não encontrado', { status: 404 })

  const pdf = await renderToBuffer(<MidiaDoc d={dados} />)

  const inline = req.nextUrl.searchParams.has('inline')
  // Nome do arquivo: "MX 1626 | Título". Barras viram hífen (quebrariam o nome)
  // e o filename* carrega os acentos em UTF-8 pros navegadores modernos.
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
