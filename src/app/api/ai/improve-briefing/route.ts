import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { otimizarBriefing } from '@/lib/ai/briefing'
import { logSystemError } from '@/lib/system-error'

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json()

    if (!text?.trim()) {
      return NextResponse.json({ error: 'Texto obrigatório' }, { status: 400 })
    }

    const result = await otimizarBriefing(text)
    if (!result) {
      return NextResponse.json({ error: 'IA não configurada' }, { status: 503 })
    }

    return NextResponse.json({ briefing: result.briefing, faltando: result.faltando })
  } catch (error) {
    console.error('AI improve error:', error)
    // O usuário vê só a mensagem genérica; a causa real (quota/API fora) vai pro log.
    try {
      const user = await getUsuario()
      if (user) {
        const supabase = await createClient()
        await logSystemError(supabase, { userId: user.id, context: 'ai:briefing', error })
      }
    } catch { /* best-effort */ }
    return NextResponse.json({ error: 'Erro ao processar com IA' }, { status: 500 })
  }
}
