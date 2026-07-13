import type { NextRequest } from 'next/server'

/**
 * Origem PÚBLICA da app pra montar redirects. Atrás do Traefik/Coolify o
 * `req.url` é o endereço interno (localhost:3000) — usa NEXT_PUBLIC_SITE_URL ou
 * os headers encaminhados. Sem isso, o OAuth volta pra localhost e quebra.
 */
export function publicBaseUrl(req: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL
  if (env) return env.replace(/\/$/, '')
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host
  return `${proto}://${host}`
}
