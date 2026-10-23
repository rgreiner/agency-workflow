/**
 * Peças da aprovação no portal, rápidas (23/10/2026).
 *
 * Medido em 20/10: cada peça custava 5–8 s — a rota revalidava a tarefa, listava
 * a Preview de novo (subindo as pastas até a raiz do Drive) e mandava o PNG de
 * impressão inteiro (até 11,8 MB; 46 MB numa tarefa de 8 peças).
 *
 * Agora:
 *  1. A TELA, que já validou a tarefa pela RPC e listou a Preview, assina cada
 *     peça (contato + tarefa + arquivo + versão + tipo + validade). A rota que
 *     confere a assinatura vai direto ao arquivo, sem RPC e sem listar.
 *  2. Imagem vai em VERSÃO DE TELA (WebP, até 1600 px), gerada uma vez e guardada
 *     no volume. A chave inclui a versão do arquivo: trocou a peça no Drive, gera
 *     de novo. O original continua no botão Baixar.
 */
import 'server-only'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { readFolderFile } from '@/lib/task-folders'

/** Validade do link assinado: o bastante para uma reunião longa. */
const VALIDADE_SEG = 12 * 60 * 60
/** Largura da versão de tela — acima disso o celular/notebook não mostra a diferença. */
const LARGURA_TELA = 1600
/** Formatos que reduzimos. GIF (animação) e SVG passam inteiros. */
const IMAGEM_REDUZIVEL = new Set(['image/png', 'image/jpeg', 'image/webp'])

function segredo(): string {
  const s = process.env.JWT_SECRET?.trim()
  if (!s) throw new Error('Falta a variável de ambiente JWT_SECRET')
  return s
}

export interface PecaAssinavel { ref: string; mime: string; versao?: string; size: number }

function conteudo(sub: string, activityId: string, ref: string, v: string, m: string, e: number): string {
  return [sub, activityId, ref, v, m, e].join('|')
}

/** Query string assinada de uma peça (vai pronta para o navegador). */
export function queryAssinada(portalSub: string, activityId: string, p: PecaAssinavel): string {
  const e = Math.floor(Date.now() / 1000) + VALIDADE_SEG
  const v = p.versao ?? String(p.size)
  const s = createHmac('sha256', segredo()).update(conteudo(portalSub, activityId, p.ref, v, p.mime, e)).digest('base64url')
  return new URLSearchParams({ ref: p.ref, v, m: p.mime, e: String(e), s }).toString()
}

/**
 * Confere a assinatura da query. Devolve a peça (ref, versão, tipo) se vale para
 * ESTE contato e ESTA tarefa e não venceu; senão null (a rota cai na validação lenta).
 */
export function pecaDaQuery(
  portalSub: string, activityId: string, q: URLSearchParams,
): { ref: string; versao: string; mime: string } | null {
  const ref = q.get('ref'), v = q.get('v'), m = q.get('m'), e = Number(q.get('e')), s = q.get('s')
  if (!ref || !v || !m || !s || !Number.isFinite(e) || e < Math.floor(Date.now() / 1000)) return null
  const esperado = createHmac('sha256', segredo()).update(conteudo(portalSub, activityId, ref, v, m, e)).digest()
  let recebido: Buffer
  try { recebido = Buffer.from(s, 'base64url') } catch { return null }
  if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) return null
  return { ref, versao: v, mime: m }
}

export function imagemReduzivel(mime: string): boolean {
  return IMAGEM_REDUZIVEL.has(mime)
}

function pastaCache(): string {
  // Dentro de portal-privado/: a rota pública /uploads recusa esse prefixo.
  return path.join(process.env.UPLOAD_DIR || '/app/uploads', 'portal-privado', '_cache', 'pecas')
}

/**
 * Versão de tela da imagem (WebP ≤ 1600 px). Primeiro pedido baixa do Drive/S3 e
 * grava no volume; os seguintes saem do disco, sem tocar no Drive.
 */
export async function imagemDeTela(ref: string, versao: string): Promise<Buffer> {
  const nome = createHash('sha1').update(`${ref}|${versao}|${LARGURA_TELA}`).digest('hex') + '.webp'
  const arquivo = path.join(pastaCache(), nome)
  try {
    return await readFile(arquivo)
  } catch { /* ainda não gerada */ }

  const original = await readFolderFile(ref)
  const tela = await sharp(original.buffer, { limitInputPixels: false })
    .rotate()
    .resize({ width: LARGURA_TELA, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer()
  // Falha ao gravar não impede de mostrar: só não fica guardada.
  try {
    await mkdir(pastaCache(), { recursive: true })
    await writeFile(arquivo, tela)
  } catch (e) {
    console.error('[portal] não gravou a versão de tela da peça', e)
  }
  return tela
}
