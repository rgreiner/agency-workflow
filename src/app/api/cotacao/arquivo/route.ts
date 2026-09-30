/**
 * Arquivos da cotação vistos por um MEMBRO: o que o fornecedor mandou
 * (?convite=<id>&idx=N) ou o que a agência anexou (?cotacao=<id>&idx=N). A RLS
 * decide: se a pessoa não é da org, a linha não vem.
 */
import { getUsuario } from '@/lib/auth/server'
import { createClient } from '@/lib/supabase/server'
import { responderArquivo } from '@/lib/cotacao-server'
import type { ArquivoRef } from '@/lib/cotacao'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const user = await getUsuario()
  if (!user) return new Response('Não autenticado', { status: 401 })
  const q = new URL(request.url).searchParams
  const idx = Number.parseInt(q.get('idx') ?? '', 10)
  if (!Number.isInteger(idx) || idx < 0) return new Response('Índice inválido', { status: 400 })

  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const convite = q.get('convite')
  const cotacao = q.get('cotacao')
  let lista: ArquivoRef[] = []
  if (convite) {
    const { data } = await sb.from('cotacao_convites').select('resposta_anexos').eq('id', convite).maybeSingle()
    lista = data?.resposta_anexos ?? []
  } else if (cotacao) {
    const { data } = await sb.from('cotacoes').select('anexos').eq('id', cotacao).maybeSingle()
    lista = data?.anexos ?? []
  }
  return responderArquivo(lista[idx])
}
