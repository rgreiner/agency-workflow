/**
 * Referências da tarefa — arquivos que a mídia (ou o atendimento) manda para a
 * criação usar de guia. Moram na subpasta **Links/** da pasta da tarefa, no
 * Drive (ou S3), e não no volume do app: quem cria trabalha no Drive, e o
 * portal do cliente nunca lê Links (só Preview). O arquivo passa pelo servidor,
 * por isso o teto por arquivo.
 *
 * GET  → { pronta, arquivos }  (pronta = a tarefa já tem pasta)
 * POST → multipart `file`      (409 + semPasta enquanto a pasta não existe: a
 *                               provisão roda em 2º plano logo depois de criar
 *                               a tarefa; o cliente espera e tenta de novo)
 */
import { NextResponse } from 'next/server'
import { getUsuario } from '@/lib/auth/server'
import { createClient } from '@/lib/supabase/server'
import { folderConfigured, listSubfolderFiles, uploadToSubfolder } from '@/lib/task-folders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 25 * 1024 * 1024
const SUBPASTA = 'Links'

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Falha ao falar com o Drive')

async function tarefaAcessivel(activityId: string) {
  const user = await getUsuario()
  if (!user) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }
  const supabase = await createClient()
  // A policy de activities já limita a membros da org: fora dela, a tarefa não existe.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('activities').select('id, drive_folder_id').eq('id', activityId).maybeSingle()
  const tarefa = data as { id: string; drive_folder_id: string | null } | null
  if (!tarefa) return { erro: NextResponse.json({ error: 'Tarefa não encontrada' }, { status: 404 }) }
  return { tarefa }
}

export async function GET(_req: Request, ctx: { params: Promise<{ activityId: string }> }) {
  const { activityId } = await ctx.params
  const r = await tarefaAcessivel(activityId)
  if ('erro' in r) return r.erro
  if (!r.tarefa.drive_folder_id || !folderConfigured()) return NextResponse.json({ pronta: false, arquivos: [] })
  try {
    const arquivos = await listSubfolderFiles(r.tarefa.drive_folder_id, SUBPASTA)
    return NextResponse.json({ pronta: true, arquivos })
  } catch (e) {
    return NextResponse.json({ error: msg(e) }, { status: 502 })
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ activityId: string }> }) {
  const { activityId } = await ctx.params
  const r = await tarefaAcessivel(activityId)
  if ('erro' in r) return r.erro

  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Arquivo ausente' }, { status: 400 })
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Arquivo muito grande (máx. 25 MB). Vídeo pesado vai direto no Drive.' }, { status: 400 })
  }
  if (!folderConfigured()) return NextResponse.json({ error: 'Integração de pastas não está configurada.' }, { status: 503 })
  if (!r.tarefa.drive_folder_id) {
    return NextResponse.json(
      { error: 'A pasta desta tarefa ainda não existe. Gere a pasta no bloco Drive e tente de novo.', semPasta: true },
      { status: 409 })
  }

  const nome = file.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'arquivo'
  try {
    const up = await uploadToSubfolder(r.tarefa.drive_folder_id, SUBPASTA, nome, file.type, Buffer.from(await file.arrayBuffer()))
    return NextResponse.json({ arquivo: { ref: up.id, name: nome, mime: file.type, size: file.size, link: up.link || undefined } })
  } catch (e) {
    return NextResponse.json({ error: msg(e) }, { status: 502 })
  }
}
