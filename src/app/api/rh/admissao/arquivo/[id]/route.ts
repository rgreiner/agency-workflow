/** Anexo da admissão visto pelo RH: a RPC só devolve a chave para quem tem rh_can. */
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { servirPrivado } from '@/lib/arquivo-privado'
import { PREFIXO_ADMISSAO } from '@/lib/admissao-server'

export const runtime = 'nodejs'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getUsuario()
  if (!user) return new Response('Não autenticado', { status: 401 })
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: chave, error } = await (supabase as any).rpc('rh_admissao_doc_chave', { p_id: id })
  if (error || !chave) return new Response('Não encontrado', { status: 404 })
  return servirPrivado(PREFIXO_ADMISSAO, chave as string)
}
