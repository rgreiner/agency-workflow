/**
 * Linha digitável do boleto e o "como pagar" do lançamento (mig. 395).
 *
 * Funções puras — servem à tela Financeiro → Hoje (servidor e cliente). A leitura
 * do PDF fica em ./do-anexo.ts, que é só servidor.
 *
 * Dois formatos FEBRABAN:
 *   • bancário (47 dígitos): "23793.38128 60000.000003 00000.000400 1 84340000010000"
 *   • arrecadação (48 dígitos, começa com 8 — DARF, DAS, concessionárias):
 *     "85870000007 3 10100385263 0 03070326296 5 45747408817 0"
 * Só aceita o que passa nos dígitos verificadores: o PDF tem CNPJ, código de
 * barras e número de documento perto da linha, e copiar o número errado para o
 * app do banco é pior do que não sugerir nada.
 */

function mod10(num: string): number {
  let soma = 0
  let peso = 2
  for (let i = num.length - 1; i >= 0; i--) {
    const p = Number(num[i]) * peso
    soma += p > 9 ? Math.floor(p / 10) + (p % 10) : p
    peso = peso === 2 ? 1 : 2
  }
  return (10 - (soma % 10)) % 10
}

function mod11Arrecadacao(num: string): number {
  let soma = 0
  let peso = 2
  for (let i = num.length - 1; i >= 0; i--) {
    soma += Number(num[i]) * peso
    peso = peso === 9 ? 2 : peso + 1
  }
  const dv = 11 - (soma % 11)
  return dv > 9 ? 0 : dv
}

function bancarioValido(d: string): boolean {
  if (d.length !== 47) return false
  return mod10(d.slice(0, 9)) === Number(d[9])
    && mod10(d.slice(10, 20)) === Number(d[20])
    && mod10(d.slice(21, 31)) === Number(d[31])
}

function arrecadacaoValida(d: string): boolean {
  if (d.length !== 48 || d[0] !== '8') return false
  const calc = d[2] === '6' || d[2] === '7' ? mod10 : d[2] === '8' || d[2] === '9' ? mod11Arrecadacao : null
  if (!calc) return false
  for (let b = 0; b < 4; b++) {
    const bloco = d.slice(b * 12, b * 12 + 11)
    if (calc(bloco) !== Number(d[b * 12 + 11])) return false
  }
  return true
}

const RE_ARRECADACAO = /(\d{11})[\s.-]*(\d)\s+(\d{11})[\s.-]*(\d)\s+(\d{11})[\s.-]*(\d)\s+(\d{11})[\s.-]*(\d)/g
const RE_BANCARIO = /(\d{5})[.\s]?(\d{5})\s+(\d{5})[.\s]?(\d{6})\s+(\d{5})[.\s]?(\d{6})\s+(\d)\s+(\d{14})/g

/** Primeira linha digitável válida no texto do PDF (só dígitos), ou null. */
export function acharLinhaDigitavel(texto: string): string | null {
  const t = texto.replace(/ /g, ' ')
  for (const re of [RE_ARRECADACAO, RE_BANCARIO]) {
    for (const m of t.matchAll(re)) {
      const d = m.slice(1).join('')
      if (arrecadacaoValida(d) || bancarioValido(d)) return d
    }
  }
  return null
}

export type TipoPagarCom = 'boleto' | 'pix_copia_cola' | 'pix_chave'

export function tipoPagarCom(codigo: string): TipoPagarCom {
  const d = codigo.replace(/[\s.-]/g, '')
  if (/^\d{47,48}$/.test(d)) return 'boleto'
  if (codigo.trim().startsWith('000201')) return 'pix_copia_cola'
  return 'pix_chave'
}

/** O que vai para a área de transferência: boleto só com dígitos (todo banco aceita). */
export function textoParaCopiar(codigo: string): string {
  return tipoPagarCom(codigo) === 'boleto' ? codigo.replace(/\D/g, '') : codigo.trim()
}

/** Linha digitável em blocos, como está no papel — para conferir de olho. */
export function formatarLinha(codigo: string): string {
  const d = codigo.replace(/\D/g, '')
  if (d.length === 48) return `${d.slice(0, 11)}-${d[11]} ${d.slice(12, 23)}-${d[23]} ${d.slice(24, 35)}-${d[35]} ${d.slice(36, 47)}-${d[47]}`
  if (d.length === 47) return `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} ${d.slice(21, 26)}.${d.slice(26, 32)} ${d[32]} ${d.slice(33)}`
  return codigo
}
