/**
 * Serve os arquivos do volume. URL: /uploads/<bucket>/<path>.
 *
 * A regra é ALLOWLIST, nunca blocklist: bucket que não estiver mapeado aqui
 * responde 404. A versão anterior bloqueava só `rh-privado` e, por isso, os
 * anexos de `portal-privado/` (que o /api/portal/upload jura serem privados)
 * saíam abertos na internet — bucket novo nascia público por omissão.
 *
 * PUBLICO = sem sessão (avatar/logo aparecem na tela de login).
 * MEMBRO  = exige o cookie flow-jwt válido. O /uploads é same-origin, então o
 *           cookie viaja junto em <img>/<a> — nada muda na UI.
 * (fora)  = 404. rh-privado e portal-privado só saem pelas rotas dedicadas
 *           (/api/rh/documento/[id] e /api/portal/anexo/[id]/[idx]).
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { getUsuario } from '@/lib/auth/server'

export const runtime = 'nodejs'

const BUCKETS_PUBLICOS = new Set(['avatars', 'org-logos'])
const BUCKETS_MEMBRO = new Set([
  'boards', 'briefings', 'comments', 'orcamentos', 'midia-kits',
  'inventario', 'lancamentos', 'ofx',
])

const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
}
// Só estas extensões o browser pode renderizar. Qualquer outra sai como download
// (attachment + octet-stream) — SVG cai aqui de propósito: com <script> embutido
// e servido inline na MESMA origem, ele entrega a sessão de quem abre o link.
const INLINE = new Set(Object.keys(TYPES))

function uploadRoot(): string {
  return process.env.UPLOAD_DIR || '/app/uploads'
}

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await params
  const rel = parts.join('/')
  if (rel.includes('..') || !/^[\w./-]+$/.test(rel)) {
    return new Response('Not found', { status: 404 })
  }

  const bucket = parts[0] ?? ''
  const publico = BUCKETS_PUBLICOS.has(bucket)
  if (!publico && !BUCKETS_MEMBRO.has(bucket)) {
    return new Response('Not found', { status: 404 })
  }
  if (!publico && !(await getUsuario())) {
    return new Response('Not found', { status: 404 })
  }

  const file = path.join(uploadRoot(), rel)
  try {
    const buf = await readFile(file)
    const ext = rel.split('.').pop()?.toLowerCase() ?? ''
    const inline = INLINE.has(ext)
    const nome = (rel.split('/').pop() || 'arquivo').replace(/"/g, '')
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': inline ? TYPES[ext] : 'application/octet-stream',
        'Content-Disposition': inline ? 'inline' : `attachment; filename="${nome}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': publico ? 'public, max-age=300' : 'private, max-age=300',
      },
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
