import 'server-only'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { pdfToText } from '@/lib/ai/folha'
import { caminhoDoAnexo } from '@/lib/agente/arquivo'
import { acharLinhaDigitavel } from './linha-digitavel'

/**
 * Linha digitável do boleto anexado ao lançamento (PDF no volume /app/uploads).
 * Sem IA: pdftotext + dígito verificador. Boleto escaneado (sem texto) ou arquivo
 * fora do volume devolve null — a tela mostra o PDF e a pessoa cola à mão.
 */
export async function linhaDoAnexo(url: string): Promise<string | null> {
  const rel = caminhoDoAnexo(url)
  if (!rel || !rel.toLowerCase().endsWith('.pdf')) return null
  try {
    const bytes = await readFile(path.join(process.env.UPLOAD_DIR || '/app/uploads', rel))
    return acharLinhaDigitavel(await pdfToText(bytes))
  } catch {
    return null
  }
}
