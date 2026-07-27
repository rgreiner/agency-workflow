/**
 * Serve UMA peça da pasta Preview de uma tarefa em aprovação, pro cliente.
 *
 * Duas travas, nesta ordem:
 *  1. A RPC `portal_aprovacao` só devolve a tarefa se ela é do workspace DAQUELE
 *     contato e está em `aprovacao_cliente` — é ela que entrega a ref da pasta.
 *  2. A ref pedida (`?ref=`) tem que estar na LISTA de peças da Preview daquela
 *     tarefa. Nunca concatenamos caminho do que veio da URL (sem traversal).
 * A pasta Final (arquivo de impressão) não é listada em lugar nenhum.
 */
import { sessaoPortal } from '@/lib/auth/portal'
import { createPortalClient } from '@/lib/supabase/portal'
import { listPreviewFiles, readFolderFileRange } from '@/lib/task-folders'

export const runtime = 'nodejs'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ activityId: string }> },
) {
  if (!(await sessaoPortal())) return new Response('Sessão expirada', { status: 401 })

  const { activityId } = await params
  const ref = new URL(request.url).searchParams.get('ref')
  if (!ref) return new Response('Peça não informada', { status: 400 })

  const supabase = await createPortalClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('portal_aprovacao', { p_activity_id: activityId })
  const pastaRef = (data as { pasta_ref?: string | null } | null)?.pasta_ref
  if (error || !pastaRef) return new Response('Não encontrado', { status: 404 })

  try {
    const pecas = await listPreviewFiles(pastaRef)
    const peca = pecas.find((p) => p.ref === ref)
    if (!peca) return new Response('Não encontrado', { status: 404 })

    // Range → 206 (byte-serving p/ vídeo; Safari não toca sem isso).
    const range = request.headers.get('range')
    const file = await readFolderFileRange(peca.ref, range)
    const baixar = new URL(request.url).searchParams.get('download') === '1'
    const nome = encodeURIComponent(file.name)
    const headers: Record<string, string> = {
      'Content-Type': file.mime,
      'Content-Disposition': `${baixar ? 'attachment' : 'inline'}; filename*=UTF-8''${nome}`,
      'Cache-Control': 'private, max-age=300',
      'Accept-Ranges': 'bytes',
      'Content-Length': String(file.buffer.length),
    }
    if (file.status === 206 && file.contentRange) headers['Content-Range'] = file.contentRange
    return new Response(new Uint8Array(file.buffer), { status: file.status, headers })
  } catch {
    return new Response('Falha ao carregar a peça', { status: 502 })
  }
}
