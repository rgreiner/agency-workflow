/**
 * Serve UMA peça da pasta Preview de uma tarefa em aprovação, pro cliente.
 *
 * Caminho rápido (23/10): a tela de aprovação, que já validou a tarefa e listou a
 * Preview, manda cada peça com uma ASSINATURA presa ao contato, à tarefa, ao
 * arquivo e à versão (lib/portal-pecas). Assinatura válida → vai direto ao
 * arquivo, sem RPC e sem listar a pasta de novo.
 *
 * Sem assinatura (link antigo), as duas travas de sempre, nesta ordem:
 *  1. A RPC `portal_aprovacao` só devolve a tarefa se ela é do workspace DAQUELE
 *     contato e está em `aprovacao_cliente` — é ela que entrega a ref da pasta.
 *  2. A ref pedida (`?ref=`) tem que estar na LISTA de peças da Preview daquela
 *     tarefa. Nunca concatenamos caminho do que veio da URL (sem traversal).
 * A pasta Final (arquivo de impressão) não é listada em lugar nenhum.
 *
 * Imagem na tela vai na versão reduzida (WebP, cache no volume); `download=1`
 * entrega o original.
 */
import { sessaoPortal } from '@/lib/auth/portal'
import { createPortalClient } from '@/lib/supabase/portal'
import { listPreviewFiles, readFolderFileRange } from '@/lib/task-folders'
import { pecaDaQuery, imagemReduzivel, imagemDeTela } from '@/lib/portal-pecas'

export const runtime = 'nodejs'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ activityId: string }> },
) {
  const claims = await sessaoPortal()
  if (!claims) return new Response('Sessão expirada', { status: 401 })

  const { activityId } = await params
  const url = new URL(request.url)
  const ref = url.searchParams.get('ref')
  if (!ref) return new Response('Peça não informada', { status: 400 })
  const baixar = url.searchParams.get('download') === '1'

  let peca: { ref: string; versao: string; mime: string } | null = pecaDaQuery(claims.portalSub, activityId, url.searchParams)
  if (!peca) {
    const supabase = await createPortalClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('portal_aprovacao', { p_activity_id: activityId })
    const pastaRef = (data as { pasta_ref?: string | null } | null)?.pasta_ref
    if (error || !pastaRef) return new Response('Não encontrado', { status: 404 })
    try {
      const achada = (await listPreviewFiles(pastaRef)).find((p) => p.ref === ref)
      if (!achada) return new Response('Não encontrado', { status: 404 })
      peca = { ref: achada.ref, versao: achada.versao ?? String(achada.size), mime: achada.mime }
    } catch {
      return new Response('Falha ao carregar a peça', { status: 502 })
    }
  }

  try {
    // Na tela: versão reduzida, que não muda enquanto a peça não mudar (a versão
    // está na URL) — o navegador pode guardar por uma semana.
    if (!baixar && imagemReduzivel(peca.mime)) {
      const tela = await imagemDeTela(peca.ref, peca.versao)
      return new Response(new Uint8Array(tela), {
        headers: {
          'Content-Type': 'image/webp',
          'Content-Disposition': 'inline',
          'Cache-Control': 'private, max-age=604800, immutable',
          'Content-Length': String(tela.length),
        },
      })
    }

    // Range → 206 (byte-serving p/ vídeo; Safari não toca sem isso).
    const range = request.headers.get('range')
    const file = await readFolderFileRange(peca.ref, range)
    const nome = encodeURIComponent(file.name)
    const headers: Record<string, string> = {
      'Content-Type': file.mime,
      'Content-Disposition': `${baixar ? 'attachment' : 'inline'}; filename*=UTF-8''${nome}`,
      'Cache-Control': 'private, max-age=3600',
      'Accept-Ranges': 'bytes',
      'Content-Length': String(file.buffer.length),
    }
    if (file.status === 206 && file.contentRange) headers['Content-Range'] = file.contentRange
    return new Response(new Uint8Array(file.buffer), { status: file.status, headers })
  } catch {
    return new Response('Falha ao carregar a peça', { status: 502 })
  }
}
