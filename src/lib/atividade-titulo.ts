/**
 * Título padrão da casa: "AAMMDD - Veículo - Formato - Título da demanda".
 * Compor e decompor moram aqui pra o form de criação (client) e a página que
 * pré-preenche a duplicação (server) falarem a mesma língua.
 *
 * As listas de veículo/formato ainda são fixas — o Rafael vai fazer uma limpa
 * pelos mais usados (levantamento de 02/09/2026) antes de virarem cadastro da org.
 */
export const VEICULOS = [
  'Meta', 'Instagram', 'Facebook', 'WhatsApp', 'TikTok',
  'YouTube', 'Google Ads', 'LinkedIn', 'E-mail', 'Impresso',
  'TV', 'Rádio', 'Site', 'Outro',
] as const

export const FORMATOS = [
  'Carrossel', 'Post', 'Stories', 'Reels', 'Vídeo',
  'Banner', 'Arte estática', 'GIF', 'Identidade Visual',
  'Texto', 'Roteiro', 'Apresentação', 'Outro',
] as const

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Data local em YYYY-MM-DD (não UTC: à noite o toISOString já é amanhã). */
export function hojeISO(): string {
  return ymd(new Date())
}

export function somarDias(iso: string, dias: number): string {
  const d = new Date(iso + 'T00:00')
  d.setDate(d.getDate() + dias)
  return ymd(d)
}

/** YYYY-MM-DD → AAMMDD (prefixo do título). */
export function prefixoDaData(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1].slice(2)}${m[2]}${m[3]}` : ''
}

export function composedTitle(date: string, veiculo: string, formato: string, titulo: string): string {
  return [date, veiculo, formato, titulo].filter(Boolean).join(' - ')
}

export interface TituloDecomposto { veiculo: string; formato: string; titulo: string }

/**
 * Decompõe um título existente (pra duplicar), sem a data. Com 3+ partes a ordem
 * é veículo, formato, resto; com 2 partes o 1º segmento é formato só se a lista
 * de formatos o conhece e a de veículos não — senão é veículo.
 */
export function decomporTitulo(title: string): TituloDecomposto {
  const partes = title.split(' - ').map(s => s.trim()).filter(Boolean)
  if (/^\d{6}$/.test(partes[0] ?? '')) partes.shift()
  if (partes.length === 0) return { veiculo: '', formato: '', titulo: '' }
  if (partes.length === 1) return { veiculo: '', formato: '', titulo: partes[0] }
  if (partes.length === 2) {
    const [a, b] = partes
    const ehFormato = (FORMATOS as readonly string[]).includes(a) && !(VEICULOS as readonly string[]).includes(a)
    return ehFormato ? { veiculo: '', formato: a, titulo: b } : { veiculo: a, formato: '', titulo: b }
  }
  const [veiculo, formato, ...resto] = partes
  return { veiculo, formato, titulo: resto.join(' - ') }
}
