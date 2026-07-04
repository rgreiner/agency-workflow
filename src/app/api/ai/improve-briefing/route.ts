import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { logSystemError } from '@/lib/system-error'

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json()

    if (!text?.trim()) {
      return NextResponse.json({ error: 'Texto obrigatório' }, { status: 400 })
    }

    // Instanciado aqui (não no topo): `new Anthropic()` sem ANTHROPIC_API_KEY
    // lança, e no topo do módulo isso quebraria a rota inteira no carregamento.
    const client = new Anthropic()

    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: `Você é um assistente especializado em comunicação para agências de publicidade e marketing.
Sua função é melhorar briefings e descrições de atividades de forma clara, objetiva e profissional.

Regras:
- Corrija erros de ortografia e gramática
- Melhore a clareza e objetividade do texto
- Mantenha o mesmo idioma (português)
- Preserve a intenção original do briefing
- Seja direto: retorne apenas o texto melhorado, sem explicações
- Não adicione títulos ou marcadores que não existiam no original
- Mantenha a estrutura do texto original`,
      messages: [
        {
          role: 'user',
          content: `Melhore este briefing de atividade:\n\n${text.trim()}`,
        },
      ],
    })

    const improved = message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')

    return NextResponse.json({ improved })
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
