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
  const isPublic = isAuthPage || isConvite

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
