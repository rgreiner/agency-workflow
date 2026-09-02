import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { otimizarBriefing } from '@/lib/ai/briefing'
import { ErroIA } from '@/lib/ai/gemini'
import { mensagemErroIA } from '@/lib/ai/erro'
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
    // A pessoa vê o MOTIVO em pt-BR (sobrecarga × sem crédito × chave), nunca o dump
    // da API; o técnico vai pro system_errors. Até 02/09 a tela dizia só "não foi
    // possível" pra tudo — e um 503 passageiro virava dúvida sobre o provedor.
    try {
      const user = await getUsuario()
      if (user) {
        const supabase = await createClient()
        await logSystemError(supabase, { userId: user.id, context: 'ai:briefing', error })
      }
    } catch { /* best-effort */ }
    return NextResponse.json(
      { error: mensagemErroIA(error, 'Não foi possível otimizar o briefing agora.') },
      { status: error instanceof ErroIA ? 503 : 500 },
    )
  }
}
