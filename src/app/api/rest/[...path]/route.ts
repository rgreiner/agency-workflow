/**
 * Proxy do PostgREST na NOSSA origem, para o browser.
 *
 * Até aqui o cookie `flow-jwt` era `httpOnly: false` de propósito: o supabase-js
 * do browser precisava LER o token para mandá-lo ao flow-api. O preço disso é
 * que qualquer XSS levava o token embora — e ele vale 7 dias, sem revogação.
 *
 * Com este proxy o browser não precisa mais ver o token: ele chama
 * `/api/rest/v1/...` na mesma origem, o cookie viaja sozinho (httpOnly) e é aqui,
 * no servidor, que o `Authorization` é montado. O token deixa de ser roubável.
 *
 * O que isso NÃO resolve, e vale dizer: um XSS ainda consegue fazer requisições
 * como o usuário logado, porque o cookie é ambiente. O que ele não consegue mais
 * é levar a credencial para fora e usá-la de outra máquina, por sete dias.
 *
 * Só o browser passa por aqui — servidor, cron e portal falam direto com o
 * PostgREST (ver lib/supabase/{server,cron,portal}.ts).
 */
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { COOKIE_TOKEN } from '@/lib/auth/jwt'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Cabeçalhos do cliente que o PostgREST entende — o resto não é repassado. */
const REQ_HEADERS = ['accept', 'accept-profile', 'content-profile', 'content-type', 'prefer', 'range', 'range-unit']
/** Cabeçalhos da resposta que o supabase-js lê. */
const RES_HEADERS = ['content-type', 'content-range', 'range-unit', 'preference-applied']

function apiBase(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!raw) return null
  return raw.replace(/\/+$/, '')
}

async function proxy(request: NextRequest, params: Promise<{ path: string[] }>) {
  const base = apiBase()
  if (!base) return NextResponse.json({ message: 'API não configurada' }, { status: 500 })

  const { path } = await params
  // `/api/rest/v1/<...>` → `<base>/rest/v1/<...>`. Sem traversal: o catch-all já
  // decodifica cada segmento, então basta recusar o que não for segmento simples.
  if (path.some(p => p === '..' || p.includes('/'))) {
    return NextResponse.json({ message: 'Caminho inválido' }, { status: 400 })
  }
  const alvo = `${base}/rest/${path.join('/')}${request.nextUrl.search}`

  // Este proxy existe só para o browser autenticado. Sem cookie, responde 401 em
  // JSON (o supabase-js sabe tratar) em vez de gastar uma ida ao PostgREST.
  const token = (await cookies()).get(COOKIE_TOKEN)?.value
  if (!token) {
    return NextResponse.json({ code: '401', message: 'Sessão expirada. Entre de novo.' }, { status: 401 })
  }

  const headers = new Headers()
  for (const h of REQ_HEADERS) {
    const v = request.headers.get(h)
    if (v) headers.set(h, v)
  }
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (anon) headers.set('apikey', anon)
  headers.set('Authorization', `Bearer ${token}`)

  const metodo = request.method
  const body = metodo === 'GET' || metodo === 'HEAD' ? undefined : await request.arrayBuffer()

  let upstream: Response
  try {
    upstream = await fetch(alvo, { method: metodo, headers, body, cache: 'no-store', redirect: 'manual' })
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : 'Falha ao falar com a API' },
      { status: 502 },
    )
  }

  const out = new Headers()
  for (const h of RES_HEADERS) {
    const v = upstream.headers.get(h)
    if (v) out.set(h, v)
  }
  out.set('Cache-Control', 'private, no-store')
  return new NextResponse(upstream.body, { status: upstream.status, headers: out })
}

type Ctx = { params: Promise<{ path: string[] }> }
export const GET = (req: NextRequest, ctx: Ctx) => proxy(req, ctx.params)
export const HEAD = (req: NextRequest, ctx: Ctx) => proxy(req, ctx.params)
export const POST = (req: NextRequest, ctx: Ctx) => proxy(req, ctx.params)
export const PATCH = (req: NextRequest, ctx: Ctx) => proxy(req, ctx.params)
export const PUT = (req: NextRequest, ctx: Ctx) => proxy(req, ctx.params)
export const DELETE = (req: NextRequest, ctx: Ctx) => proxy(req, ctx.params)
