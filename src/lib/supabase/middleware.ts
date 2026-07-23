/**
 * Gate "otimista" do proxy (Next 16): valida o cookie JWT `flow-jwt` (Web
 * Crypto, roda no edge) e redireciona. A autorização de verdade é a RLS no
 * banco — aqui é só UX de rota. Não usa mais supabase/GoTrue.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE_TOKEN, verifyToken } from '@/lib/auth/jwt'

export async function updateSession(request: NextRequest) {
  const claims = await verifyToken(request.cookies.get(COOKIE_TOKEN)?.value)

  const path = request.nextUrl.pathname
  const isAuthPage = path.startsWith('/login')
  const isConvite = path.startsWith('/convite/')
  // /api/cron tem auth própria (header x-cron-secret) e é chamada sem cookie pelo
  // crontab — não pode ser redirecionada pro /login (viraria HTML no lugar do JSON).
  const isCron = path.startsWith('/api/cron')
  // /portal é do CLIENTE (cookie flow-portal-jwt próprio, validado nas páginas) —
  // nunca exigir o flow-jwt de membro aqui.
  const isPortal = path === '/portal' || path.startsWith('/portal/')
  const isPublic = isAuthPage || isConvite || isCron || isPortal

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

  return NextResponse.next({ request })
}
