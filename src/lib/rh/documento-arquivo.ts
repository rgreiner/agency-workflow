import 'server-only'
import { readFile, unlink } from 'node:fs/promises'
import path from 'node:path'

/**
 * Apagar de verdade o arquivo de um documento de RH.
 *
 * Antes da migration 198 a exclusão só removia a linha do banco: o PDF ficava em
 * /app/uploads/rh-privado/ para sempre. Num acervo com ASO e atestado, "sumiu da
 * tela" não é o mesmo que "foi apagado".
 *
 * A ordem importa: apaga o arquivo PRIMEIRO e só então a linha. Se fosse ao
 * contrário e o unlink falhasse, sobraria exatamente o órfão que se quer evitar
 * — e sem nem saber que ele existe.
 */
export function uploadRoot(): string {
  return process.env.UPLOAD_DIR || '/app/uploads'
}

/** Resolve a chave dentro da raiz de uploads, recusando escapar dela. */
export function caminhoSeguro(chave: string): string | null {
  if (!chave || !chave.startsWith('rh-privado/')) return null
  const raiz = path.resolve(uploadRoot())
  const alvo = path.resolve(raiz, chave)
  // `..` na chave levaria a apagar arquivo fora do volume de uploads.
  if (alvo !== raiz && !alvo.startsWith(raiz + path.sep)) return null
  return alvo
}

/** `ok` também quando o arquivo já não existia — o objetivo é que ele não esteja lá. */
export async function apagarArquivoDocumento(chave: string | null | undefined): Promise<{ ok: boolean; erro?: string }> {
  if (!chave) return { ok: true }
  const alvo = caminhoSeguro(chave)
  if (!alvo) return { ok: false, erro: `Chave fora do volume de RH: ${chave}` }
  try {
    await unlink(alvo)
    return { ok: true }
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err?.code === 'ENOENT') return { ok: true }
    return { ok: false, erro: err?.message ?? 'falha ao apagar' }
  }
}

/** Lê o arquivo para anexar num e-mail. Mesmo guard de caminho da exclusão. */
export async function lerArquivoDocumento(
  chave: string | null | undefined,
): Promise<{ ok: boolean; conteudo?: Buffer; erro?: string }> {
  if (!chave) return { ok: false, erro: 'documento sem arquivo' }
  const alvo = caminhoSeguro(chave)
  if (!alvo) return { ok: false, erro: `chave fora do volume de RH: ${chave}` }
  try {
    return { ok: true, conteudo: await readFile(alvo) }
  } catch (e) {
    return { ok: false, erro: (e as Error)?.message ?? 'falha ao ler' }
  }
}
