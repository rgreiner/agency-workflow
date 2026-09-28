import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { otimizarBriefing } from '@/lib/ai/briefing'
import { iaDaOrg } from '@/lib/ai/provedor'
import { mensagemErroRevisao } from '@/lib/ai/review'
import { ErroIA } from '@/lib/ai/gemini'
import { logSystemError } from '@/lib/system-error'

/**
 * Org de quem pede, para usar a chave de IA dela. As telas não mandam a org no
 * corpo: vem do `orgSlug` (se mandarem) ou do 1º segmento da página de origem
 * (Referer); a RLS de `organizations` só devolve org de que a pessoa é membro.
 * Sem nada disso, a primeira org da pessoa.
 */
async function orgDoPedido(request: NextRequest, orgSlug: unknown): Promise<string | null> {
  const supabase = await createClient()
  let slug = typeof orgSlug === 'string' ? orgSlug : ''
  if (!slug) {
    try { slug = new URL(request.headers.get('referer') ?? '').pathname.split('/')[1] ?? '' } catch { slug = '' }
  }
  if (slug) {
    const { data } = await supabase.from('organizations').select('id').eq('slug', slug).maybeSingle()
    if (data?.id) return data.id
  }
  const user = await getUsuario()
  if (!user) return null
  const { data: m } = await supabase.from('organization_members').select('org_id').eq('user_id', user.id).limit(1).maybeSingle()
  return (m as { org_id?: string } | null)?.org_id ?? null
}

export async function POST(request: NextRequest) {
  let provider: 'anthropic' | 'gemini' = 'gemini'
  try {
    const { text, orgSlug } = await request.json()

    if (!text?.trim()) {
      return NextResponse.json({ error: 'Texto obrigatório' }, { status: 400 })
    }

    const cfg = await iaDaOrg(await orgDoPedido(request, orgSlug))
    if (cfg?.apiKey) provider = cfg.provider
    const result = await otimizarBriefing(text, cfg)
    if (!result) {
      return NextResponse.json({ error: 'IA não configurada. Um administrador cadastra a chave em Configurações → Revisão IA.' }, { status: 503 })
    }

    return NextResponse.json({ briefing: result.briefing, faltando: result.faltando })
  } catch (error) {
    console.error('AI improve error:', error)
    // A pessoa vê o MOTIVO em pt-BR (sobrecarga × sem crédito × chave), nunca o dump
    // da API; o técnico vai pro system_errors.
    try {
      const user = await getUsuario()
      if (user) {
        const supabase = await createClient()
        await logSystemError(supabase, { userId: user.id, context: 'ai:briefing', error })
      }
    } catch { /* best-effort */ }
    return NextResponse.json(
      { error: mensagemErroRevisao(error, provider, 'Não foi possível otimizar o briefing agora.') },
      { status: error instanceof ErroIA ? 503 : 500 },
    )
  }
}
