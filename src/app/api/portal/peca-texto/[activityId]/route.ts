/**
 * Converte uma peça .docx da pasta Preview em HTML pro cliente LER o conteúdo
 * (roteiros, textos) sem baixar. Mesmas 2 travas da rota da peça: a RPC valida a
 * tarefa e dá a pasta; a ref pedida TEM que estar na lista da Preview.
 * Só .docx — mammoth não lê .doc binário antigo (aí o cliente baixa).
 */
import mammoth from 'mammoth'
import { sessaoPortal } from '@/lib/auth/portal'
import { createPortalClient } from '@/lib/supabase/portal'
import { listPreviewFiles, readFolderFile } from '@/lib/task-folders'

export const runtime = 'nodejs'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const isDocx = (name: string, mime: string) =>
  mime === DOCX_MIME || name.toLowerCase().endsWith('.docx')

export async function GET(
  request: Request,
  { params }: { params: Promise<{ activityId: string }> },
) {
  if (!(await sessaoPortal())) return Response.json({ error: 'Sessão expirada' }, { status: 401 })

  const { activityId } = await params
  const ref = new URL(request.url).searchParams.get('ref')
  if (!ref) return Response.json({ error: 'Peça não informada' }, { status: 400 })

  const supabase = await createPortalClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('portal_aprovacao', { p_activity_id: activityId })
  const pastaRef = (data as { pasta_ref?: string | null } | null)?.pasta_ref
  if (error || !pastaRef) return Response.json({ error: 'Não encontrado' }, { status: 404 })

  try {
    const pecas = await listPreviewFiles(pastaRef)
    const peca = pecas.find((p) => p.ref === ref)
    if (!peca) return Response.json({ error: 'Não encontrado' }, { status: 404 })
    if (!isDocx(peca.name, peca.mime)) {
      return Response.json({ error: 'Pré-visualização de texto só para .docx' }, { status: 415 })
    }

    const file = await readFolderFile(peca.ref)
    const { value: html } = await mammoth.convertToHtml({ buffer: file.buffer })
    return Response.json({ html })
  } catch {
    return Response.json({ error: 'Falha ao ler o documento' }, { status: 502 })
  }
}
