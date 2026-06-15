/**
 * Recebe um upload (multipart) do browser e grava num volume do VPS.
 * Substitui o Supabase Storage. Só usuários logados. Devolve a URL pública
 * absoluta (servida por /uploads/[...path]).
 */
import { NextResponse } from 'next/server'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { getUsuario } from '@/lib/auth/server'

export const runtime = 'nodejs'

const ALLOWED_BUCKETS = new Set(['avatars', 'org-logos'])
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'])
const MAX_BYTES = 2 * 1024 * 1024 // 2 MB

function uploadRoot(): string {
  return process.env.UPLOAD_DIR || '/app/uploads'
}

export async function POST(request: Request) {
  const user = await getUsuario()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const form = await request.formData()
  const bucket = String(form.get('bucket') || '')
  const rel = String(form.get('path') || '')
  const file = form.get('file')

  if (!ALLOWED_BUCKETS.has(bucket)) return NextResponse.json({ error: 'Bucket inválido' }, { status: 400 })
  if (!(file instanceof File)) return NextResponse.json({ error: 'Arquivo ausente' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Arquivo muito grande (máx 2MB)' }, { status: 400 })
  if (file.type && !ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: 'Tipo de arquivo não permitido' }, { status: 400 })
  // path seguro: só letras/dígitos/._-/ e sem traversal
  if (!/^[\w./-]+$/.test(rel) || rel.includes('..')) return NextResponse.json({ error: 'Caminho inválido' }, { status: 400 })

  const dest = path.join(uploadRoot(), bucket, rel)
  await mkdir(path.dirname(dest), { recursive: true })
  await writeFile(dest, Buffer.from(await file.arrayBuffer()))

  // Atrás do Traefik, request.url é o endereço interno (localhost:3000) —
  // usa os headers encaminhados pra montar a URL pública correta.
  const proto = request.headers.get('x-forwarded-proto') ?? 'https'
  const host =
    request.headers.get('x-forwarded-host') ??
    request.headers.get('host') ??
    new URL(request.url).host
  return NextResponse.json({ url: `${proto}://${host}/uploads/${bucket}/${rel}` })
}
