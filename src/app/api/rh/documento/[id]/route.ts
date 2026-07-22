/**
 * Serve um documento de RH — autenticado. Só entrega o arquivo se o usuário
 * enxerga o documento pela RLS (rh_can → owner/admin ou can_rh na org). O arquivo
 * vive em rh-privado/ (fora do alcance da rota pública /uploads).
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { getUsuario } from '@/lib/auth/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const TYPES: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
}

function uploadRoot(): string {
  return process.env.UPLOAD_DIR || '/app/uploads'
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUsuario()
  if (!user) return new Response('Não autenticado', { status: 401 })

  const { id } = await params
  const supabase = await createClient()
  // A RLS de rh_documento (rh_can) filtra: se o usuário não pode ver, não vem linha.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: doc } = await (supabase as any)
    .from('rh_documento').select('chave, nome').eq('id', id).maybeSingle()
  if (!doc?.chave) return new Response('Não encontrado', { status: 404 })

  const rel = String(doc.chave)
  // Defesa: a chave TEM que estar no prefixo privado e sem traversal.
  if (!rel.startsWith('rh-privado/') || rel.includes('..')) return new Response('Não encontrado', { status: 404 })

  try {
    const buf = await readFile(path.join(uploadRoot(), rel))
    const ext = rel.split('.').pop()?.toLowerCase() ?? ''
    const type = TYPES[ext] ?? 'application/octet-stream'
    const nome = encodeURIComponent(String(doc.nome || 'documento'))
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
