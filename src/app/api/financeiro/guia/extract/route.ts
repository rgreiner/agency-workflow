/**
 * Recebe o PDF de uma guia (Darf/FGTS/DAS/GPS/parcelamento/boleto de tributo),
 * extrai por IA e devolve a PRÉVIA estruturada (não grava nada — o usuário
 * confere no modal, que busca o lançamento e aplica). Exige acesso ao Financeiro.
 */
import { NextResponse } from 'next/server'
import { getUsuario } from '@/lib/auth/server'
import { getAccess } from '@/lib/auth/access'
import { pdfToText } from '@/lib/ai/folha'
import { extrairGuia } from '@/lib/ai/guia'
import { mensagemErroIA } from '@/lib/ai/erro'
import { createClient } from '@/lib/supabase/server'
import { logSystemError } from '@/lib/system-error'

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
  if (file.type && file.type !== 'application/pdf') return NextResponse.json({ error: 'Envie o PDF da guia' }, { status: 400 })
  if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: 'PDF muito grande (máx 15MB)' }, { status: 400 })

  const acc = await getAccess(orgSlug)
  if (!acc || !acc.access.financeiro) return NextResponse.json({ error: 'Sem acesso ao Financeiro' }, { status: 403 })

  try {
    const texto = await pdfToText(Buffer.from(await file.arrayBuffer()))
    if (texto.trim().length < 30) return NextResponse.json({ error: 'Não consegui ler texto do PDF (é digitalizado?)' }, { status: 422 })
    const guia = await extrairGuia(texto)
    if (!guia) return NextResponse.json({ error: 'IA não configurada (ANTHROPIC_API_KEY)' }, { status: 503 })
    if (!guia.valor || !guia.vencimento) return NextResponse.json({ error: 'Não reconheci valor e vencimento na guia — confira o PDF' }, { status: 422 })
    return NextResponse.json(guia)
  } catch (e) {
    // O detalhe técnico (dump do provedor, stack do pdftotext) fica no
    // system_errors, que só o admin lê; a tela recebe a versão em pt-BR.
    console.error('[guia/extract] falha', e)
    await logSystemError(await createClient(), { userId: user.id, context: 'financeiro:guia-extract', error: e })
    return NextResponse.json({ error: mensagemErroIA(e, 'a guia') }, { status: 500 })
  }
}
