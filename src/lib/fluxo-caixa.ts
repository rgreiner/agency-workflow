// Agregações do Fluxo de Caixa a partir do extrato importado (extrato_importado).
// Reproduz as duas telas da Conta Azul: diário (dia a dia do mês) e mensal
// (previsto × realizado do ano). Tudo puro — recebe as linhas e devolve séries.

import { isRealizado, isPrevisto, isTransferencia } from './extrato'

export interface FluxoRow {
  data_mov: string | null
  data_prevista: string | null
  venc_original: string | null
  tipo: string | null
  valor: number | null
  situacao: string | null
  conta: string | null
  origem: string | null
  categoria: string | null
}

const abs = (v: number | null) => Math.abs(v ?? 0)
// Sinal p/ saldo: receita soma, despesa subtrai (transferências incluídas — afetam
// o saldo de cada conta; em "todas as contas" se anulam).
const signed = (r: FluxoRow) => (r.tipo === 'receita' ? abs(r.valor) : r.tipo === 'despesa' ? -abs(r.valor) : 0)
// Data de previsão de um lançamento em aberto.
const dataPrev = (r: FluxoRow) => r.data_prevista || r.venc_original || r.data_mov

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export function contasDistintas(rows: FluxoRow[]): string[] {
  const set = new Set<string>()
  for (const r of rows) if (r.conta) set.add(r.conta)
  return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

export function anosDisponiveis(rows: FluxoRow[]): number[] {
  const set = new Set<number>()
  for (const r of rows) {
    const d = r.data_mov ?? dataPrev(r)
    if (d) set.add(Number(d.slice(0, 4)))
  }
  return [...set].sort((a, b) => a - b)
}

export interface DiaPonto {
  dia: string            // 'DD'
  recebimentos: number   // + (verde, acima do eixo)
  pagamentos: number     // − (vermelho, abaixo do eixo)
  saldo: number          // linha (saldo acumulado real)
}

// Filtra por um conjunto de contas; null ou lista vazia = todas.
function filtraContas(rows: FluxoRow[], contas: string[] | null): FluxoRow[] {
  if (!contas || contas.length === 0) return rows
  const set = new Set(contas)
  return rows.filter(r => r.conta != null && set.has(r.conta))
}

/** Diário: dia a dia de um mês (ym = 'YYYY-MM'), filtrado por contas (ou todas). */
export function fluxoDiario(rows: FluxoRow[], ym: string, contas: string[] | null): DiaPonto[] {
  const sel = filtraContas(rows, contas)
  const [y, m] = ym.split('-').map(Number)
  const diasNoMes = new Date(y, m, 0).getDate()
  const monthStart = `${ym}-01`

  // saldo de abertura do mês: acumulado realizado antes do mês
  let saldoStart = 0
  for (const r of sel) {
    if (isRealizado(r.situacao) && r.data_mov && r.data_mov < monthStart) saldoStart += signed(r)
  }

  const receb = new Array(diasNoMes + 1).fill(0)
  const pag = new Array(diasNoMes + 1).fill(0)
  const mov = new Array(diasNoMes + 1).fill(0) // movimento de saldo do dia (com transferências)
  for (const r of sel) {
    if (!isRealizado(r.situacao) || !r.data_mov || r.data_mov.slice(0, 7) !== ym) continue
    const d = Number(r.data_mov.slice(8, 10))
    if (d < 1 || d > diasNoMes) continue
    mov[d] += signed(r)
    if (isTransferencia(r.origem, r.categoria)) continue
    if (r.tipo === 'receita') receb[d] += abs(r.valor)
    else if (r.tipo === 'despesa') pag[d] += abs(r.valor)
  }

  const out: DiaPonto[] = []
  let saldo = saldoStart
  for (let d = 1; d <= diasNoMes; d++) {
    saldo += mov[d]
    out.push({ dia: String(d).padStart(2, '0'), recebimentos: receb[d], pagamentos: -pag[d], saldo })
  }
  return out
}

export interface MesPonto {
  mes: string             // 'jan'
  recRealizado: number
  pagRealizado: number    // negativo (p/ barra abaixo do eixo)
  recPrevisto: number
  pagPrevisto: number     // negativo
  saldoRealizado: number
  saldoPrevisto: number
}

/** Mensal previsto × realizado de um ano, filtrado por contas (ou todas). */
export function fluxoMensal(rows: FluxoRow[], ano: number, contas: string[] | null): MesPonto[] {
  const sel = filtraContas(rows, contas)
  const recR = new Array(12).fill(0), pagR = new Array(12).fill(0)
  const recP = new Array(12).fill(0), pagP = new Array(12).fill(0)

  for (const r of sel) {
    if (isRealizado(r.situacao) && r.data_mov && Number(r.data_mov.slice(0, 4)) === ano) {
      if (!isTransferencia(r.origem, r.categoria)) {
        const mi = Number(r.data_mov.slice(5, 7)) - 1
        if (r.tipo === 'receita') recR[mi] += abs(r.valor)
        else if (r.tipo === 'despesa') pagR[mi] += abs(r.valor)
      }
    } else if (isPrevisto(r.situacao)) {
      const dp = dataPrev(r)
      if (dp && Number(dp.slice(0, 4)) === ano && !isTransferencia(r.origem, r.categoria)) {
        const mi = Number(dp.slice(5, 7)) - 1
        if (r.tipo === 'receita') recP[mi] += abs(r.valor)
        else if (r.tipo === 'despesa') pagP[mi] += abs(r.valor)
      }
    }
  }

  // saldos acumulados até o fim de cada mês
  const out: MesPonto[] = []
  for (let mi = 0; mi < 12; mi++) {
    const fimMes = `${ano}-${String(mi + 1).padStart(2, '0')}-31`
    let sR = 0, sP = 0
    for (const r of sel) {
      const isReal = isRealizado(r.situacao) && r.data_mov && r.data_mov <= fimMes
      if (isReal) { sR += signed(r); sP += signed(r); continue }
      if (isPrevisto(r.situacao)) {
        const dp = dataPrev(r)
        if (dp && dp <= fimMes) sP += signed(r)
      }
    }
    out.push({
      mes: MESES[mi],
      recRealizado: recR[mi], pagRealizado: -pagR[mi],
      recPrevisto: recP[mi], pagPrevisto: -pagP[mi],
      saldoRealizado: sR, saldoPrevisto: sP,
    })
  }
  return out
}
