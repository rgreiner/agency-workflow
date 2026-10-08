// Contratação: tipos e o texto da carta oferta. Módulo puro — a tela do RH, a
// página do candidato e o PDF montam a MESMA carta a partir daqui.

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://flow.oneaone.com.br').replace(/\/$/, '')
/** Link público do candidato. */
export const urlProposta = (token: string) => `${SITE_URL}/proposta/${token}`

export interface JornadaProposta {
  entrada?: string; intervalo_ini?: string; intervalo_fim?: string; saida?: string
  dias_semana?: number[]
  horas_semanais?: number
}
export interface BeneficiosProposta {
  va_dia?: number
  va_desconto_pct?: number
  vt?: boolean
  vt_desconto_pct?: number
  ajuda_custo?: number
  ajuda_custo_nome?: string
  /** Frases soltas da casa ("happy hour na última sexta-feira"). */
  extras?: string[]
}
export interface PropostaDados {
  nome: string
  cargo?: string | null
  salario?: number | string | null
  data_inicio?: string | null
  data_primeiro_pagamento?: string | null
  local_trabalho?: string | null
  jornada?: JornadaProposta | null
  beneficios?: BeneficiosProposta | null
}

export const STATUS_ADMISSAO: Record<string, { label: string; cls: string }> = {
  rascunho:  { label: 'Rascunho',          cls: 'bg-gray-100 text-gray-600' },
  enviada:   { label: 'Aguardando aceite', cls: 'bg-sky-500/15 text-sky-800 dark:text-sky-300' },
  aceita:    { label: 'Aceita',            cls: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300' },
  recusada:  { label: 'Recusada',          cls: 'bg-gray-100 text-gray-500' },
  ficha:     { label: 'Ficha preenchida',  cls: 'bg-orange-500/15 text-orange-800 dark:text-orange-300' },
  efetivada: { label: 'Efetivada',         cls: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300' },
  cancelada: { label: 'Cancelada',         cls: 'bg-gray-100 text-gray-500' },
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
/** "2026-06-29" → "29 de junho de 2026" (a carta escreve a data por extenso). */
export function dataExtenso(iso?: string | null): string {
  if (!iso) return ''
  const [a, m, d] = iso.split('-').map(Number)
  if (!a || !m || !d) return ''
  return `${d} de ${MESES[m - 1]} de ${a}`
}
/** "08:30" → "8h30"; "12:00" → "12h" (como a carta sempre escreveu). */
export function hora(h?: string | null): string {
  if (!h) return ''
  const [hh, mm] = h.slice(0, 5).split(':')
  return mm === '00' ? `${Number(hh)}h` : `${Number(hh)}h${mm}`
}
const DIAS = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta-feira', 'sábado', 'domingo']
function faixaDeDias(dias?: number[]): string {
  const d = [...(dias?.length ? dias : [1, 2, 3, 4, 5])].sort((x, y) => x - y)
  const seguido = d.every((v, i) => i === 0 || v === d[i - 1] + 1)
  if (seguido && d.length > 1) return `${DIAS[d[0]]} a ${DIAS[d[d.length - 1]]}`
  return d.map(n => DIAS[n]).join(', ')
}
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const num = (v: number | string | null | undefined) =>
  v == null || v === '' ? null : typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.'))

/** Minutos de jornada por dia, a partir dos quatro horários. */
function cargaDiaria(j: JornadaProposta): number {
  const min = (t?: string) => { const [h, m] = (t ?? '').slice(0, 5).split(':').map(Number); return (h || 0) * 60 + (m || 0) }
  const total = (min(j.intervalo_ini) - min(j.entrada)) + (min(j.saida) - min(j.intervalo_fim))
  return total > 0 ? total : 0
}
/** Horas semanais: informadas ou derivadas da jornada × dias. */
export function horasSemanais(j?: JornadaProposta | null): number {
  if (!j) return 40
  if (j.horas_semanais) return j.horas_semanais
  const dias = j.dias_semana?.length ?? 5
  return Math.round((cargaDiaria(j) * dias) / 60)
}

/**
 * A carta oferta da casa, com o texto que o Rafael já usa (a do Luka, 06/2026).
 * Sai como rascunho editável: a palavra final é dele, não minha — por isso o
 * texto é gravado em `rh_admissao.carta` e a partir dali ninguém regenera.
 */
export function montarCarta(d: PropostaDados, agencia: string): string {
  const j = d.jornada ?? {}
  const b = d.beneficios ?? {}
  const salario = num(d.salario)
  const p: string[] = []

  p.push(`Prezado(a) ${d.nome},`)
  p.push(`A ${agencia} tem o prazer de oferecer a você a posição de ${d.cargo || '—'}.`)

  const jornadaTxt = [
    `A sua jornada de trabalho será de ${faixaDeDias(j.dias_semana)}`,
    j.entrada && j.intervalo_ini ? `, das ${hora(j.entrada)} às ${hora(j.intervalo_ini)}` : '',
    j.intervalo_fim && j.saida ? ` e das ${hora(j.intervalo_fim)} às ${hora(j.saida)}` : '',
    ` (totalizando ${horasSemanais(j)}h semanais)`,
    d.data_inicio ? `, com início em ${dataExtenso(d.data_inicio)}` : '',
    '.',
    d.local_trabalho ? ` O trabalho será realizado presencialmente no nosso endereço na ${d.local_trabalho}.` : '',
  ].join('')
  p.push(jornadaTxt)

  if (salario) {
    p.push(`Nesta posição, a sua remuneração mensal será de ${brl(salario)}, paga sempre no último dia útil de cada mês`
      + `${d.data_primeiro_pagamento ? `, a partir de ${dataExtenso(d.data_primeiro_pagamento)}` : ''}.`)
  }

  const ben: string[] = []
  if (b.va_dia) {
    ben.push(`você terá direito ao vale-alimentação pelo Caju no valor de ${brl(b.va_dia)} por dia`
      + `${b.va_desconto_pct ? ` (com desconto de ${b.va_desconto_pct}% em folha)` : ''}`)
  }
  if (b.vt) {
    ben.push(`se necessário, ao vale-transporte${b.vt_desconto_pct ? ` com desconto de apenas ${b.vt_desconto_pct}% sobre o salário` : ''}`)
  }
  if (ben.length) p.push(`Como parte do time ${agencia}, ${ben.join(' e ')}.`
    + (b.ajuda_custo ? ` Além disso, oferecemos uma ajuda de custo de até ${brl(b.ajuda_custo)} para o seu ${b.ajuda_custo_nome || 'material de trabalho'}.` : ''))

  const extras = (b.extras ?? []).filter(Boolean)
  if (extras.length) p.push(`E para completar nossos benefícios, temos ${extras.join(', ')}.`)

  p.push('Se estiver de acordo com estes termos, é só aceitar a proposta no botão abaixo.')
  return p.join('\n\n')
}
