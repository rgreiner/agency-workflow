/**
 * Arquivos que o FORNECEDOR pode ver pelo link: os anexos da agência (?a=idx),
 * a imagem de referência de um item do orçamento (?item=idx) e os que ele mesmo
 * enviou (?r=idx). Tudo resolvido a partir do token.
 */
import { bytesDeUpload, mimeDoArquivo } from '@/lib/uploads-volume'
import { convitePorToken, responderArquivo } from '@/lib/cotacao-server'

export const runtime = 'nodejs'

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const cv = await convitePorToken(token)
  if (!cv) return new Response('Não encontrado', { status: 404 })

  const q = new URL(request.url).searchParams
  const idx = (k: string) => { const n = Number.parseInt(q.get(k) ?? '', 10); return Number.isInteger(n) && n >= 0 ? n : null }

  const a = idx('a')
  if (a != null) return responderArquivo(cv.anexos[a])
  const r = idx('r')
  if (r != null) return responderArquivo(cv.resposta_anexos[r])

  // Foto do produto que ESTE fornecedor subiu (antes ou depois de enviar a proposta).
  const foto = q.get('foto')
  if (foto) {
    if (!foto.startsWith(`cotacao-privado/${cv.org_id}/${cv.cotacao_id}/${cv.id}/`)) return new Response('Não encontrado', { status: 404 })
    return responderArquivo({ chave: foto, nome: 'foto' })
  }

  const item = idx('item')
  if (item != null) {
    // Só itens que foram pedidos nesta cotação.
    const pedido = cv.itens.find(i => i.idx === item)
    if (!pedido) return new Response('Não encontrado', { status: 404 })
    const url = cv.detalhe_itens?.[item]?.imagem
    const mime = url ? mimeDoArquivo(url) : null
    if (!url || !mime?.startsWith('image/')) return new Response('Não encontrado', { status: 404 })
    const buf = await bytesDeUpload(url)
    if (!buf) return new Response('Não encontrado', { status: 404 })
    return new Response(new Uint8Array(buf), {
      headers: { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' },
    })
  }
  return new Response('Não encontrado', { status: 404 })
}
