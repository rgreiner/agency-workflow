/**
 * Recebe o PDF da folha, extrai por IA e devolve a PRÉVIA estruturada (não grava
 * nada — o usuário confere e confirma na tela, que chama importarFolha). Exige can_rh.
 */
import { NextResponse } from 'next/server'
import { getUsuario } from '@/lib/auth/server'
import { getAccess } from '@/lib/auth/access'
import { pdfToText, extrairFolha } from '@/lib/ai/folha'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(request: Request) {
  const user = await getUsuario()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const form = await request.formData()
  const orgSlug = String(form.get('orgSlug') || '')
  const file = form.get('file')
  if (!orgSlug) return NextResponse.json({ error: 'Org ausente' }, { status: 400 })
  if (!(file instanceof File)) return NextResponse.json({ error: 'Arquivo ausente' }, { status: 400 })
  if (file.type && file.type !== 'application/pdf') return NextResponse.json({ error: 'Envie o PDF da folha' }, { status: 400 })
  if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: 'PDF muito grande (máx 15MB)' }, { status: 400 })

  const acc = await getAccess(orgSlug)
  if (!acc || !acc.access.rh) return NextResponse.json({ error: 'Sem acesso ao RH' }, { status: 403 })

  try {
    const texto = await pdfToText(Buffer.from(await file.arrayBuffer()))
    if (texto.trim().length < 50) return NextResponse.json({ error: 'Não consegui ler texto do PDF (é digitalizado?)' }, { status: 422 })
    const folha = await extrairFolha(texto)
    if (!folha) return NextResponse.json({ error: 'IA não configurada (ANTHROPIC_API_KEY)' }, { status: 503 })
    if (!folha.linhas.length) return NextResponse.json({ error: 'Nenhum trabalhador reconhecido no PDF' }, { status: 422 })
    return NextResponse.json(folha)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Falha na extração' }, { status: 500 })
  }
}
