/**
 * Link TEMPORÁRIO de um anexo de lançamento (NF/boleto) para o agente mandar ao
 * cliente. O /uploads exige sessão de membro; o cliente não tem. Então o link
 * carrega o caminho + validade + HMAC, e /api/agente/arquivo confere sem banco.
 *
 * Só o bucket `lancamentos` sai por aqui, e só por 72 h.
 */
import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

const VALIDADE_SEG = 72 * 60 * 60
const CAMINHO = /^lancamentos\/[\w.-]+$/

function chave(): Buffer {
  const s = process.env.JWT_SECRET?.trim()
  if (!s) throw new Error('Falta a variável de ambiente JWT_SECRET')
  // Chave própria derivada: a assinatura do link nunca serve como JWT e vice-versa.
  return createHmac('sha256', s).update('agente-arquivo-v1').digest()
}

function assinatura(caminho: string, exp: number): string {
  return createHmac('sha256', chave()).update(`${caminho}|${exp}`).digest('base64url')
}

/** "/uploads/lancamentos/x.pdf" (ou a URL inteira) → caminho no volume, se for anexo de lançamento. */
export function caminhoDoAnexo(url: string): string | null {
  const i = url.indexOf('/uploads/')
  if (i < 0) return null
  const rel = url.slice(i + '/uploads/'.length).split(/[?#]/)[0]
  return CAMINHO.test(rel) ? rel : null
}

export function linkAssinado(base: string, caminho: string): string {
  const exp = Math.floor(Date.now() / 1000) + VALIDADE_SEG
  const q = new URLSearchParams({ p: caminho, e: String(exp), s: assinatura(caminho, exp) })
  return `${base.replace(/\/$/, '')}/api/agente/arquivo?${q}`
}

/** Devolve o caminho se a query é válida e não expirou. */
export function conferirLink(q: URLSearchParams): string | null {
  const p = q.get('p') ?? '', e = Number(q.get('e')), s = q.get('s') ?? ''
  if (!CAMINHO.test(p) || !Number.isFinite(e) || e < Date.now() / 1000) return null
  const certo = Buffer.from(assinatura(p, e)), veio = Buffer.from(s)
  return certo.length === veio.length && timingSafeEqual(certo, veio) ? p : null
}
