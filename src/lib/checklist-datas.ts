/**
 * Item de checklist com data — utilidades PURAS, para servir o componente no
 * cliente e as actions no servidor com a mesma régua.
 */

export const hojeISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })

/** Data de calendário válida em YYYY-MM-DD (31/02 não passa). */
export function dataValida(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const d = new Date(iso + 'T12:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso
}

/**
 * Lê "10/05 Dia das Mães", "10/05/2027 Natal", "2026-05-10 Dia das Mães" ou
 * "08/03 – Dia da Mulher" (o separador depois da data é opcional).
 * Sem ano: com `anoPadrao` usa esse ano; sem ele, a PRÓXIMA ocorrência da data —
 * hoje ou à frente fica no ano corrente, o que já passou vai para o ano que vem.
 * Data inválida vira item sem data, com a linha inteira como texto.
 */
export function lerLinhaComData(linha: string, anoPadrao?: number): { text: string; data: string | null } {
  const s = linha.trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})\s*[-–:·]?\s*(.*)$/)
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}`
    return dataValida(iso) ? { text: m[4].trim() || s, data: iso } : { text: s, data: null }
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*[-–:·]?\s*(.*)$/)
  if (!m) return { text: s, data: null }
  const dd = Number(m[1]), mm = Number(m[2])
  const hoje = hojeISO()
  const iso = (ano: number) => `${ano}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
  let ano: number
  if (m[3]) ano = Number(m[3].length === 2 ? `20${m[3]}` : m[3])
  else if (anoPadrao) ano = anoPadrao
  else {
    ano = Number(hoje.slice(0, 4))
    if (dataValida(iso(ano)) && iso(ano) < hoje) ano += 1
  }
  if (!dataValida(iso(ano))) return { text: s, data: null }
  return { text: m[4].trim() || s, data: iso(ano) }
}
