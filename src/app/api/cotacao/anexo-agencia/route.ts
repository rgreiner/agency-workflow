/**
 * Upload de anexo da AGÊNCIA para o pedido de cotação (arte, faca, referência).
 * Só membro logado; grava em cotacao-privado/agencia/<org>/, fora da rota
 * /uploads, porque quem vai ler é o fornecedor pelo token.
 */
import { NextResponse } from 'next/server'
import { getUsuario } from '@/lib/auth/server'
import { createClient } from '@/lib/supabase/server'
import { gravarArquivo } from '@/lib/cotacao-server'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const user = await getUsuario()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const form = await request.formData()
  const orgSlug = String(form.get('org') || '')
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Arquivo ausente' }, { status: 400 })
  // Org pela RLS: só vem se a pessoa é membro.
  const supabase = await createClient()
  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  const ref = await gravarArquivo(`agencia/${org.id}`, file)
  if ('error' in ref) return NextResponse.json(ref, { status: 400 })
  return NextResponse.json(ref)
}
