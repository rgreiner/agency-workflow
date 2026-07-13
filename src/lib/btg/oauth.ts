/**
 * OAuth 2.0 (Authorization Code) do BTG Empresas — obrigatório p/ as APIs bancárias
 * (client_credentials NÃO acessa banking). Access token 24h; refresh token 10 dias
 * SLIDING (reseta a cada uso) e rotaciona → guardamos sempre o mais recente.
 */
import crypto from 'node:crypto'
import { btgConfig } from './config'

export interface BtgTokens {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
}

// ── state assinado (anti-CSRF, amarra o callback à org/usuário) ──────────────
function stateSecret(): string {
  const s = process.env.JWT_SECRET?.trim()
  if (!s) throw new Error('Falta JWT_SECRET (usado p/ assinar o state do OAuth BTG).')
  return s
}
const b64url = (b: Buffer) => b.toString('base64url')

export function signState(payload: { org: string; uid: string }): string {
  const body = b64url(Buffer.from(JSON.stringify({ ...payload, t: Math.floor(Date.now() / 1000) })))
  const sig = b64url(crypto.createHmac('sha256', stateSecret()).update(body).digest())
  return `${body}.${sig}`
}

export function verifyState(state: string, maxAgeSec = 900): { org: string; uid: string } | null {
  const [body, sig] = (state || '').split('.')
  if (!body || !sig) return null
  const expected = b64url(crypto.createHmac('sha256', stateSecret()).update(body).digest())
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const obj = JSON.parse(Buffer.from(body, 'base64url').toString()) as { org: string; uid: string; t: number }
    if (!obj.t || Math.floor(Date.now() / 1000) - obj.t > maxAgeSec) return null
    return { org: obj.org, uid: obj.uid }
  } catch { return null }
}

// ── URLs / trocas de token ───────────────────────────────────────────────────
export function authorizeUrl(state: string): string {
  const c = btgConfig()
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    scope: c.scopes,
    state,
    prompt: 'login',
  })
  return `${c.idBase}/oauth2/authorize?${q.toString()}`
}

async function tokenRequest(bodyParams: Record<string, string>): Promise<BtgTokens> {
  const c = btgConfig()
  const basic = Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')
  const res = await fetch(`${c.idBase}/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(bodyParams).toString(),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`BTG token ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text) as BtgTokens
}

export function exchangeCode(code: string): Promise<BtgTokens> {
  const c = btgConfig()
  return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: c.redirectUri })
}

export function refreshTokens(refreshToken: string): Promise<BtgTokens> {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken })
}
