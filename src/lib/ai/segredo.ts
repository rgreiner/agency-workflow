import 'server-only'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

/**
 * Cifra de segredos guardados no banco (hoje: a chave da API de IA da org).
 * AES-256-GCM com chave derivada de AI_KEY_SECRET (ou JWT_SECRET, que já existe
 * em produção). Trocar o segredo torna as chaves ilegíveis — aí a tela pede para
 * cadastrar de novo; nunca derruba o app.
 */
function chave(): Buffer {
  const base = process.env.AI_KEY_SECRET || process.env.JWT_SECRET
  if (!base) throw new Error('Falta AI_KEY_SECRET/JWT_SECRET para cifrar a chave da IA.')
  return createHash('sha256').update(`flow:ai-key:${base}`).digest()
}

export function cifrar(texto: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', chave(), iv)
  const dados = Buffer.concat([c.update(texto, 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), dados.toString('base64')].join('.')
}

/** Devolve null quando o valor não abre (segredo trocado ou dado corrompido). */
export function decifrar(valor: string | null | undefined): string | null {
  if (!valor) return null
  const [v, iv, tag, dados] = valor.split('.')
  if (v !== 'v1' || !iv || !tag || !dados) return null
  try {
    const d = createDecipheriv('aes-256-gcm', chave(), Buffer.from(iv, 'base64'))
    d.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([d.update(Buffer.from(dados, 'base64')), d.final()]).toString('utf8')
  } catch {
    return null
  }
}
