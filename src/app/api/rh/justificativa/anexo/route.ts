/**
 * Anexo da justificativa de ponto (atestado, declaração de comparecimento…).
 *
 * Rota SEPARADA da /api/rh/upload de propósito: aquela é do RH e grava
 * qualquer tipo de documento na ficha. Aqui quem sobe é o próprio colaborador,
 * então o escopo é estreito — o arquivo entra sempre como 'atestado', sempre na
 * ficha de quem está autenticado (ou de quem o RH indicar), e a permissão é
 * decidida no banco pela RPC rh_justificativa_anexo.
 *
 * Grava no mesmo prefixo privado dos outros documentos de RH (rh-privado/), que
 * a rota pública /uploads recusa: atestado é dado de saúde e não pode ficar
 * atrás de uma URL adivinhável. A leitura é pela rota autenticada
 * /api/rh/documento/[id].
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
  if (file.type && !ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'Envie um PDF ou uma imagem.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Arquivo muito grande (máx 20MB)' }, { status: 400 })

  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // Só para descobrir a org e montar o caminho. Quem autoriza de fato é a RPC
  // (rh_can OU rh_is_self) — o colaborador enxerga a própria ficha pela policy
  // rh_colaborador_self_read.
  const { data: colab } = await sb.from('rh_colaborador')
    .select('id, org_id').eq('id', colaboradorId).maybeSingle()
  if (!colab) return NextResponse.json({ error: 'Sem acesso a esta ficha' }, { status: 403 })

  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
  const chave = `rh-privado/${colab.org_id}/${colaboradorId}/${randomUUID()}.${ext}`

  const { data: docId, error } = await sb.rpc('rh_justificativa_anexo', {
    p_colaborador: colaboradorId, p_nome: file.name, p_chave: chave, p_competencia: null,
  })
  // O registro vem ANTES do arquivo: se a permissão for negada, nada é gravado
  // no disco. O inverso deixaria arquivo órfão no volume a cada tentativa.
  if (error) return NextResponse.json({ error: error.message }, { status: 403 })

  const dest = path.join(uploadRoot(), chave)
  await mkdir(path.dirname(dest), { recursive: true })
  await writeFile(dest, Buffer.from(await file.arrayBuffer()))

  return NextResponse.json({ doc_id: docId as string, nome: file.name })
}
