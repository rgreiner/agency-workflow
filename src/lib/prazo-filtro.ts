/**
 * Filtro de prazo por presets — a MESMA régua na Lista e na fila da Mídia.
 * Extraído da Lista sem mudar uma linha; datas em YYYY-MM-DD (string pura),
 * `today` vem de quem chama.
 */
export const DATE_FILTERS = [
  { value: '',          label: 'Qualquer prazo' },
  { value: 'overdue',   label: 'Atrasadas' },
  { value: 'due3',      label: 'Atrasadas + 3 dias' },
  { value: 'nextweek',  label: 'Próxima semana' },
  { value: 'next15',    label: 'Próximos 15 dias' },
  { value: 'noduedate', label: 'Sem prazo' },
]
export function shiftYMD(base: string, days: number) {
  const [y, m, d] = base.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}
/** Próxima semana = segunda a domingo da semana seguinte. */
export function nextWeekRange(today: string): [string, string] {
  const [y, m, d] = today.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 dom … 6 sáb
  const toMon = (1 - dow + 7) % 7
  const start = shiftYMD(today, toMon === 0 ? 7 : toMon)
  return [start, shiftYMD(start, 6)]
}
export function matchesDateFilter(due: string | null, f: string, today: string): boolean {
  if (!f) return true
  if (f === 'noduedate') return !due
  if (!due) return false
  const d = due.slice(0, 10)
  if (f === 'overdue') return d < today
  if (f === 'due3') return d <= shiftYMD(today, 3)
  if (f === 'next15') return d >= today && d <= shiftYMD(today, 15)
  if (f === 'nextweek') { const [s, e] = nextWeekRange(today); return d >= s && d <= e }
  return true
}
