/**
 * Upload de anexo do PORTAL DO CLIENTE. Autenticado pela sessão do portal
 * (cookie flow-portal-jwt), não pela do membro. Grava num prefixo privado do
 * volume (portal-privado/), que a rota pública /uploads recusa; devolve a CHAVE
 * (nunca URL pública). O arquivo só é lido de volta por um MEMBRO via
 * /api/portal/anexo/[id]/[idx].
 */
import { NextResponse } from 'next/server'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { sessaoPortal } from '@/lib/auth/portal'
import { sql } from '@/lib/db'

export const runtime = 'nodejs'

const ALLOWED_TYPES = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword', 'application/vnd.ms-excel', 'text/plain',
])
const MAX_BYTES = 25 * 1024 * 1024

function uploadRoot(): string {
  return process.env.UPLOAD_DIR || '/app/uploads'
}

export async function POST(request: Request) {
  const claims = await sessaoPortal()
  if (!claims) return NextResponse.json({ error: 'Sessão expirada' }, { status: 401 })

  // org/workspace vêm do BANCO (linha do contato), nunca do form — o cliente
  // não escolhe onde grava.
  const rows = await sql<{ org_id: string; workspace_id: string }[]>`
    select org_id, workspace_id from public.portal_users where id = ${claims.portalSub} and ativo limit 1
  `
  const pu = rows[0]
  if (!pu) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })

  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Arquivo ausente' }, { status: 400 })
  if (file.type && !ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'Tipo não permitido (PDF, imagem, documento)' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Arquivo muito grande (máx 25MB)' }, { status: 400 })

  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)
  const chave = `portal-privado/${pu.org_id}/${pu.workspace_id}/${randomUUID()}.${ext}`
  const dest = path.join(uploadRoot(), chave)
  await mkdir(path.dirname(dest), { recursive: true })
  await writeFile(dest, Buffer.from(await file.arrayBuffer()))

  return NextResponse.json({ chave, nome: file.name })
}
