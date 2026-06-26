/**
 * Serve os arquivos do volume (avatars, org-logos) publicamente.
 * URL: /uploads/<bucket>/<path>. Como termina em extensão de imagem, o
 * proxy (gate de auth) não intercepta — leitura pública, igual ao Supabase.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const runtime = 'nodejs'

const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
}

function uploadRoot(): string {
  return process.env.UPLOAD_DIR || '/app/uploads'
}

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await params
  const rel = parts.join('/')
  if (rel.includes('..') || !/^[\w./-]+$/.test(rel)) {
    return new Response('Not found', { status: 404 })
  }

  const file = path.join(uploadRoot(), rel)
  try {
    const buf = await readFile(file)
    const ext = rel.split('.').pop()?.toLowerCase() ?? ''
    const type = TYPES[ext] ?? 'application/octet-stream'
    return new Response(new Uint8Array(buf), {
      headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=300' },
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
