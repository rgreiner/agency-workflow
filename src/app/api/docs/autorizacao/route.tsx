// PDF do Relatório de Autorização (cliente × competência), no servidor.
// Mesmo padrão dos outros documentos: o botão baixa direto e `?inline=1`
// devolve o mesmo PDF para visualizar na tela.

import { NextRequest } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { loadAutorizacao } from '@/lib/pdf/autorizacao-data'
import { AutorizacaoDoc } from '@/lib/pdf/AutorizacaoDoc'

// A competência muda enquanto o mês não fecha: nunca cachear.
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getUsuario()
  if (!user) return new Response('Não autenticado', { status: 401 })

  const org     = req.nextUrl.searchParams.get('org')
  const cliente = req.nextUrl.searchParams.get('cliente')
  const comp    = req.nextUrl.searchParams.get('comp')
  if (!org || !cliente || !comp) return new Response('Parâmetros faltando', { status: 400 })

  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // Lido com o token do usuário: quem não enxerga a org pela RLS não baixa.
  const { data: orgRow } = await sb.from('organizations').select('id').eq('slug', org).maybeSingle()
  if (!orgRow) return new Response('Organização não encontrada', { status: 404 })

  const dados = await loadAutorizacao(sb, orgRow.id as string, cliente, comp)
  if (!dados) return new Response('Relatório não encontrado', { status: 404 })

  const pdf = await renderToBuffer(<AutorizacaoDoc d={dados} />)

  const inline = req.nextUrl.searchParams.has('inline')
  const nome = `${dados.nomeArquivo}.pdf`.replace(/[/\\]/g, '-')
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
