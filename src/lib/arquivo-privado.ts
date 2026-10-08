import 'server-only'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { uploadRoot } from '@/lib/uploads-volume'

/**
 * Arquivo de link público (cotação, admissão): fica FORA de /uploads, que exige
 * sessão de membro, e só é servido por rota que confere quem pode ver.
 */
const TIPOS: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', heic: 'image/heic',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}
const INLINE = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif'])
export const MAX_ARQUIVO = 15 * 1024 * 1024

export interface ArquivoPrivado { chave: string; nome: string }

/** Grava em <prefixo>/<pasta>/<uuid>.<ext>. O nome original é só rótulo. */
export async function gravarPrivado(prefixo: string, pasta: string, file: File): Promise<ArquivoPrivado | { error: string }> {
  const ext = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)
  if (!TIPOS[ext]) return { error: 'Tipo não aceito (PDF, foto ou Word)' }
  if (file.size > MAX_ARQUIVO) return { error: 'Arquivo muito grande (máx 15MB)' }
  const chave = `${prefixo}/${pasta}/${randomUUID()}.${ext}`
  const dest = path.join(uploadRoot(), chave)
  await mkdir(path.dirname(dest), { recursive: true })
  await writeFile(dest, Buffer.from(await file.arrayBuffer()))
  return { chave, nome: file.name.slice(0, 160) }
}

/** Resposta HTTP com o arquivo: imagem e PDF abrem na tela, o resto baixa. */
export async function servirPrivado(prefixo: string, chave: string, nome?: string | null): Promise<Response> {
  if (!chave.startsWith(`${prefixo}/`) || chave.includes('..')) return new Response('Não encontrado', { status: 404 })
  try {
    const buf = await readFile(path.join(uploadRoot(), chave))
    const ext = chave.split('.').pop()?.toLowerCase() ?? ''
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': TIPOS[ext] ?? 'application/octet-stream',
        'Content-Disposition': `${INLINE.has(ext) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(nome || 'arquivo')}`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    })
  } catch {
    return new Response('Não encontrado', { status: 404 })
  }
}

/** Lê o arquivo privado para anexar em e-mail. null se sumiu do volume. */
export async function lerPrivado(chave: string): Promise<Buffer | null> {
  if (chave.includes('..')) return null
  try { return await readFile(path.join(uploadRoot(), chave)) } catch { return null }
}
