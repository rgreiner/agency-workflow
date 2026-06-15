/**
 * Usuário atual no BROWSER (client components). Decodifica o payload do JWT
 * do cookie `flow-jwt` — SEM verificar assinatura (o browser não tem o
 * segredo). É só p/ UI e p/ passar o id a RPCs; a autorização real é feita
 * pelo PostgREST (valida o JWT) + RLS no banco.
 */
import { COOKIE_TOKEN } from './jwt'

function b64urlToStr(s: string): string {
  let t = s.replace(/-/g, '+').replace(/_/g, '/')
  while (t.length % 4) t += '='
  return atob(t)
}

export function getUsuarioClient(): { id: string; email: string } | null {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(new RegExp('(?:^|; )' + COOKIE_TOKEN + '=([^;]*)'))
  if (!m) return null
  try {
    const token = decodeURIComponent(m[1])
    const payload = JSON.parse(b64urlToStr(token.split('.')[1]))
    if (!payload?.sub) return null
    return { id: String(payload.sub), email: String(payload.email ?? '') }
  } catch {
    return null
  }
}
