import 'server-only'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Bytes de um arquivo que o app guardou no volume (`/uploads/...`), lidos do
 * DISCO — nunca pela rede.
 *
 * A rota /uploads exige o cookie `flow-jwt`: quem busca do servidor vai sem
 * cookie e leva 404 em silêncio (foi o que quebrou a imagem do Orçamento em
 * julho, ver lib/pdf/imagem.ts). A regra do caminho é a mesma da rota: nada de
 * subir diretório.
 *
 * URL externa ainda cai no fetch — é o caso de anexo que veio de fora.
 */
export function uploadRoot(): string {
  return process.env.UPLOAD_DIR || '/app/uploads'
}

export async function bytesDeUpload(url: string | null | undefined): Promise<Buffer | null> {
  if (!url) return null
  const semQuery = url.split('?')[0]
  const marca = '/uploads/'
  const i = semQuery.indexOf(marca)
  if (i >= 0) {
    const rel = semQuery.slice(i + marca.length)
    if (rel.includes('..') || !/^[\w./-]+$/.test(rel)) return null
    try {
      return await readFile(path.join(uploadRoot(), rel))
    } catch {
      return null   // arquivo sumiu do volume
    }
  }
  if (/^https?:\/\//.test(url)) {
    try {
      const r = await fetch(url)
      if (!r.ok) return null
      return Buffer.from(await r.arrayBuffer())
    } catch {
      return null
    }
  }
  return null
}

/** MIME pela extensão do nome/URL — o anexo do lançamento não guarda o tipo. */
export function mimeDoArquivo(nomeOuUrl: string): string | null {
  const ext = (nomeOuUrl.split('?')[0].split('.').pop() || '').toLowerCase()
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  return null
}
