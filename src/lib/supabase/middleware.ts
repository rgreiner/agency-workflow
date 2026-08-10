/**
 * Gate "otimista" do proxy (Next 16): valida o cookie JWT `flow-jwt` (Web
 * Crypto, roda no edge) e redireciona. A autorização de verdade é a RLS no
 * banco — aqui é só UX de rota. Não usa mais supabase/GoTrue.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE_TOKEN, RENOVAR_APOS_SEG, mintToken, opcoesCookie, verifyToken } from '@/lib/auth/jwt'

export async function updateSession(request: NextRequest) {
  const claims = await verifyToken(request.cookies.get(COOKIE_TOKEN)?.value)

  const path = request.nextUrl.pathname
  const isAuthPage = path.startsWith('/login')
  const isConvite = path.startsWith('/convite/')
  // /api/cron tem auth própria (header x-cron-secret) e é chamada sem cookie pelo
  // crontab — não pode ser redirecionada pro /login (viraria HTML no lugar do JSON).
  const isCron = path.startsWith('/api/cron')
  // /portal é do CLIENTE (cookie flow-portal-jwt próprio, validado nas páginas) —
  // nunca exigir o flow-jwt de membro aqui. /api/portal/* faz a própria auth
  // (sessão do portal no upload; sessão de membro na leitura de anexo).
  const isPortal = path === '/portal' || path.startsWith('/portal/') || path.startsWith('/api/portal/')
  // /api/rest é o proxy do PostgREST pro browser: sem sessão ele responde 401 em
  // JSON, que é o que o supabase-js sabe tratar. Redirecionar pro /login devolveria
  // HTML no lugar da resposta da API.
  const isRest = path.startsWith('/api/rest/')
  // Ativos do PWA e de link-preview: o navegador busca manifest e ícones SEM
  // cookie (fetch sem credenciais, por spec) e o /sw.js não pode ser
  // redirecionado (a resposta viraria o HTML do login e o registro falha).
  // /offline é a página que o service worker cacheia pra servir sem rede.
  const isPwaAsset =
    path === '/manifest.webmanifest' || path === '/sw.js' || path === '/offline' ||
    path === '/icon' || path === '/apple-icon' || path === '/opengraph-image'
  const isPublic = isAuthPage || isConvite || isCron || isPortal || isRest || isPwaAsset

  if (!claims && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (claims && isAuthPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  const res = NextResponse.next({ request })

  // Sessão deslizante: enquanto a pessoa usa o Flow, o token é re-emitido e os
  // 7 dias voltam a contar. Só cai no login quem passar 7 dias sem aparecer.
  // Ainda vale o token que veio na request (o de baixo só chega no próximo
  // request), então nada quebra no meio do caminho.
  if (claims && Math.floor(Date.now() / 1000) - claims.iat > RENOVAR_APOS_SEG) {
    res.cookies.set(
      COOKIE_TOKEN,
      await mintToken({ sub: claims.sub, email: claims.email }),
      opcoesCookie(),
    )
  }

  return res
}
