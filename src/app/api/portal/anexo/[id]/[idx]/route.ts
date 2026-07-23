/**
 * Serve um anexo de uma entrada do cliente — autenticado por MEMBRO. Só entrega
 * se o membro enxerga a entrada pela RLS de portal_entries (membro da org). O
 * arquivo vive em portal-privado/ (fora do alcance da rota pública /uploads).
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { getUsuario } from '@/lib/auth/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const TYPES: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', txt: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

function uploadRoot(): string {
  return process.env.UPLOAD_DIR || '/app/uploads'
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; idx: string }> }) {
  const user = await getUsuario()
  if (!user) return new Response('Não autenticado', { status: 401 })

  const { id, idx } = await params
  const i = Number.parseInt(idx, 10)
  if (!Number.isInteger(i) || i < 0) return new Response('Índice inválido', { status: 400 })

  const supabase = await createClient()
  // A RLS de portal_entries filtra: se o membro não é da org, não vem linha.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: entry } = await (supabase as any)
    .from('portal_entries').select('anexos').eq('id', id).maybeSingle()
  const anexos = Array.isArray(entry?.anexos) ? entry.anexos : []
  const anexo = anexos[i] as { chave?: string; nome?: string } | undefined
  if (!anexo?.chave) return new Response('Não encontrado', { status: 404 })

  const rel = String(anexo.chave)
  if (!rel.startsWith('portal-privado/') || rel.includes('..')) return new Response('Não encontrado', { status: 404 })

  try {
    const buf = await readFile(path.join(uploadRoot(), rel))
    const ext = rel.split('.').pop()?.toLowerCase() ?? ''
    const type = TYPES[ext] ?? 'application/octet-stream'
    const nome = encodeURIComponent(String(anexo.nome || 'anexo'))
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': type,
        'Content-Disposition': `inline; filename*=UTF-8''${nome}`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch {
    return new Response('Não encontrado', { status: 404 })
  }
}
