/** Anexo de lançamento por link assinado (ver lib/agente/arquivo.ts). */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { conferirLink } from '@/lib/agente/arquivo'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const rel = conferirLink(new URL(req.url).searchParams)
  if (!rel) return new Response('Link expirado ou inválido', { status: 404 })
  try {
    const buf = await readFile(path.join(process.env.UPLOAD_DIR || '/app/uploads', rel))
    const pdf = rel.toLowerCase().endsWith('.pdf')
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': pdf ? 'application/pdf' : 'application/octet-stream',
        'Content-Disposition': pdf ? 'inline' : `attachment; filename="${rel.split('/').pop()}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    })
  } catch {
    return new Response('Arquivo não encontrado', { status: 404 })
  }
}
