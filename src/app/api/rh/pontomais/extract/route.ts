/**
 * Lê o PDF "Jornada" do Pontomais e devolve a prévia da importação.
 * Só extrai/parseia — quem grava é a action (rh_importar_pontomais).
 * Usa pdftotext -layout (poppler), igual ao inventário/folha.
 */
import { NextResponse } from 'next/server'
import { writeFile, unlink, mkdtemp } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import os from 'node:os'
import { getUsuario } from '@/lib/auth/server'
import { getAccess } from '@/lib/auth/access'
import { parsePontomais } from '@/lib/pontomais'

const exec = promisify(execFile)
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  const user = await getUsuario()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const form = await request.formData()
  const orgSlug = String(form.get('orgSlug') || '')
  const file = form.get('file')
  if (!orgSlug) return NextResponse.json({ error: 'Organização ausente' }, { status: 400 })
  if (!(file instanceof File)) return NextResponse.json({ error: 'Arquivo ausente' }, { status: 400 })
  if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: 'Arquivo muito grande (máx 25MB)' }, { status: 400 })

  const acc = await getAccess(orgSlug)
  if (!acc?.access.rh) return NextResponse.json({ error: 'Sem acesso ao RH' }, { status: 403 })

  const dir = await mkdtemp(path.join(os.tmpdir(), 'pm-'))
  const pdf = path.join(dir, 'j.pdf')
  try {
    await writeFile(pdf, Buffer.from(await file.arrayBuffer()))
    const { stdout } = await exec('pdftotext', ['-layout', pdf, '-'], { maxBuffer: 32 * 1024 * 1024 })
    const rel = parsePontomais(stdout)
    if (!rel.pessoas.length) {
      return NextResponse.json({ error: 'Não reconheci o formato (esperado: relatório "Jornada" do Pontomais em PDF de texto).' }, { status: 422 })
    }
    return NextResponse.json(rel)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao ler o PDF'
    return NextResponse.json({ error: /ENOENT/.test(msg) ? 'pdftotext (poppler) não disponível no servidor' : msg }, { status: 500 })
  } finally {
    await unlink(pdf).catch(() => {})
  }
}
