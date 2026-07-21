// Bisemana da mídia exterior: período de 14 dias, de segunda a domingo.
//
// A numeração segue a SEMANA ISO PAR que fecha o período: a bisemana N cobre as
// semanas ISO N-1 e N. Confere com o que a agência já usa —
//   bisemana 18/26 → 20/04/2026 a 03/05/2026
// que é exatamente a segunda da semana 17 até o domingo da semana 18 de 2026.
// Por isso as opções vão de 2 em 2 (2, 4, 6 … 52).

/** Segunda-feira da semana ISO 1 do ano (a semana que contém 4 de janeiro). */
function segundaDaSemana1(ano: number): Date {
  const quatroJan = new Date(Date.UTC(ano, 0, 4))
  // getUTCDay: domingo = 0 → tratamos como 7 para a semana começar na segunda.
  const diaSemana = quatroJan.getUTCDay() || 7
  return new Date(Date.UTC(ano, 0, 4 - (diaSemana - 1)))
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const addDias = (d: Date, n: number) => new Date(d.getTime() + n * 86400000)

/** Início (segunda) e fim (domingo) da bisemana N do ano, em ISO `YYYY-MM-DD`. */
export function periodoDaBisemana(numero: number, ano: number): { inicio: string; fim: string } {
  const primeira = numero - 1                       // a bisemana N abre na semana N-1
  const inicio = addDias(segundaDaSemana1(ano), (primeira - 1) * 7)
  return { inicio: iso(inicio), fim: iso(addDias(inicio, 13)) }
}

const br = (isoStr: string) => isoStr.split('-').reverse().join('/')

/** Rótulo que a agência escreve no documento: "20/04/2026 até 03/05/2026". */
export function periodoLabel(numero: number, ano: number): string {
  const { inicio, fim } = periodoDaBisemana(numero, ano)
  return `${br(inicio)} até ${br(fim)}`
}

/** "18/26" → 18. Devolve null para 'outro' ou qualquer coisa fora do padrão. */
export function numeroDaBisemana(valor: string): number | null {
  const m = /^(\d{1,2})\//.exec(valor || '')
  if (!m) return null
  const n = Number(m[1])
  return n >= 2 && n <= 52 ? n : null
}
