/**
 * Upload de documento de RH — SENSÍVEL. Grava num prefixo privado do volume
 * (rh-privado/), que a rota pública /uploads recusa. O arquivo só é lido de volta
 * pela rota autenticada /api/rh/documento/[id]. Exige can_rh na org do colaborador.
 * Devolve a CHAVE (caminho relativo), nunca uma URL pública.
 */
import { NextResponse } from 'next/server'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getUsuario } from '@/lib/auth/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const ALLOWED_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
const MAX_BYTES = 20 * 1024 * 1024

function uploadRoot(): string {
  return process.env.UPLOAD_DIR || '/app/uploads'
}

export async function POST(request: Request) {
  const user = await getUsuario()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const form = await request.formData()
  const colaboradorId = String(form.get('colaboradorId') || '')
  const file = form.get('file')

  if (!colaboradorId) return NextResponse.json({ error: 'Colaborador ausente' }, { status: 400 })
  if (!(file instanceof File)) return NextResponse.json({ error: 'Arquivo ausente' }, { status: 400 })
  if (file.type && !ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: 'Tipo não permitido (PDF ou imagem)' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Arquivo muito grande (máx 20MB)' }, { status: 400 })

  // Autorização: o colaborador tem que existir numa org onde o usuário tem can_rh.
  // A RLS de rh_colaborador (rh_can) já garante isso — se não vier linha, nega.
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: colab } = await (supabase as any)
    .from('rh_colaborador').select('id, org_id').eq('id', colaboradorId).maybeSingle()
  if (!colab) return NextResponse.json({ error: 'Sem acesso a este colaborador' }, { status: 403 })

  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
  const chave = `rh-privado/${colab.org_id}/${colaboradorId}/${randomUUID()}.${ext}`
  const dest = path.join(uploadRoot(), chave)
  await mkdir(path.dirname(dest), { recursive: true })
  await writeFile(dest, Buffer.from(await file.arrayBuffer()))

  return NextResponse.json({ chave, nome: file.name })
}
