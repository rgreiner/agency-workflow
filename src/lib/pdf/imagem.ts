// Imagem para dentro do PDF — sem passar pela rede e sempre em formato que o
// react-pdf entende.
//
// Duas armadilhas somadas quebravam a imagem do Orçamento, em silêncio:
//  (1) `/uploads/orcamentos/…` exige o cookie `flow-jwt` (allowlist da rota
//      /uploads). O react-pdf busca a URL do SERVIDOR, sem cookie nenhum →
//      404 → item sem foto.
//  (2) o upload grava tudo em WebP, e o @react-pdf/image só decodifica PNG e
//      JPEG. Mesmo com a sessão resolvida a imagem não entraria.
//
// Aqui o arquivo é lido direto do volume (o mesmo disco que a rota /uploads
// serve) e convertido para PNG. Falha vira `null`: documento sem a foto é
// ruim, documento que não baixa é pior.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

/** Largura máxima no PDF — acima disso é peso de arquivo, não nitidez: a foto do
 *  item do Orçamento é desenhada com 96pt de largura. */
const MAX_W = 600

function uploadRoot(): string {
  return process.env.UPLOAD_DIR || '/app/uploads'
}

/** Bytes da imagem: do volume quando é /uploads (o caso normal), senão pela rede. */
async function bytesDe(url: string): Promise<Buffer | null> {
  const semQuery = url.split('?')[0]
  const marca = '/uploads/'
  const i = semQuery.indexOf(marca)
  if (i >= 0) {
    const rel = semQuery.slice(i + marca.length)
    // mesma régua da rota /uploads: nada de subir diretório
    if (rel.includes('..') || !/^[\w./-]+$/.test(rel)) return null
    return readFile(path.join(uploadRoot(), rel))
  }
  if (/^https?:\/\//.test(url)) {
    const r = await fetch(url)
    if (!r.ok) return null
    return Buffer.from(await r.arrayBuffer())
  }
  return null
}

/**
 * `url` → data URI PNG pronto para `<Image src=…>` do react-pdf.
 * Devolve `null` quando não dá para resolver (arquivo sumido, formato inválido).
 */
export async function imagemParaPdf(url: string | null | undefined): Promise<string | null> {
  if (!url) return null
  try {
    const bytes = await bytesDe(url)
    if (!bytes) return null
    const img = sharp(bytes).resize({ width: MAX_W, withoutEnlargement: true })
    // PNG só quando há transparência a preservar (logo). Foto em PNG multiplicava
    // o tamanho do PDF por ~7 — um orçamento de 6 fotos passava de 3 MB.
    const { hasAlpha } = await sharp(bytes).metadata()
    const saida = hasAlpha
      ? { buf: await img.png().toBuffer(), mime: 'png' }
      : { buf: await img.jpeg({ quality: 82 }).toBuffer(), mime: 'jpeg' }
    return `data:image/${saida.mime};base64,${saida.buf.toString('base64')}`
  } catch {
    return null
  }
}
