/**
 * Linha do tempo de uma tarefa por STATUS (visão "Tempos" do cliente).
 *
 * Reconstrói, a partir do `activity_history` (gravado em toda transição desde a
 * criação), quanto tempo a tarefa passou em cada etapa — inclusive quando o
 * mesmo status se repete (ida e volta). Tempo CORRIDO de propósito: a leitura é
 * lead time do processo ("quanto demora atravessar"), não horas trabalhadas —
 * horas trabalhadas são o módulo de Horas (apontamento implícito).
 *
 * Lógica pura (sem IO) para ser testável.
 */

export interface TransicaoHist {
  from_status: string | null
  to_status: string
  changed_at: string
}

export interface Segmento {
  status: string
  ini: string   // ISO
  fim: string   // ISO
  ms: number
}

/** Segmentos < 1 min são ruído de transições em sequência (ex.: lote) — somem. */
const MIN_MS = 60_000

/**
 * Monta os segmentos da tarefa.
 * - trecho antes da 1ª transição fica no from_status dela (ou no to_status, se a
 *   1ª linha é o registro de criação — from null — e o trecho é ~0);
 * - o último trecho corre até `agora`, EXCETO quando o status final é de
 *   encerramento (`finais`): barra fecha na conclusão, não estica até hoje.
 * - sem histórico nenhum: um segmento único no status atual desde a criação.
 */
export function buildSegmentos(
  createdAt: string,
  statusAtual: string,
  history: TransicaoHist[],
  agoraISO: string,
  finais: Set<string>,
): Segmento[] {
  const hs = [...history].sort((a, b) => a.changed_at.localeCompare(b.changed_at))
  const out: Segmento[] = []
  const push = (status: string, ini: string, fim: string) => {
    const ms = new Date(fim).getTime() - new Date(ini).getTime()
    if (ms >= MIN_MS) out.push({ status, ini, fim, ms })
  }

  if (!hs.length) {
    push(statusAtual, createdAt, finais.has(statusAtual) ? createdAt : agoraISO)
    return out
  }

  const primeiro = hs[0]
  push(primeiro.from_status ?? primeiro.to_status, createdAt, primeiro.changed_at)

  for (let i = 0; i < hs.length; i++) {
    const fim = i + 1 < hs.length ? hs[i + 1].changed_at : null
    const status = hs[i].to_status
    if (fim) {
      push(status, hs[i].changed_at, fim)
    } else if (!finais.has(status)) {
      push(status, hs[i].changed_at, agoraISO)
    }
    // status final de encerramento: sem segmento aberto — a barra termina ali.
  }
  return out
}

export interface TotalStatus { status: string; ms: number; passagens: number }

/** Soma os segmentos por status (ida e volta agrega no mesmo total). */
export function totaisPorStatus(segs: Segmento[]): TotalStatus[] {
  const m = new Map<string, TotalStatus>()
  for (const s of segs) {
    const t = m.get(s.status) ?? { status: s.status, ms: 0, passagens: 0 }
    t.ms += s.ms
    t.passagens += 1
    m.set(s.status, t)
  }
  return [...m.values()]
}

/** "3d 4h" · "5h 12m" · "38m" — durações de processo, sempre legíveis. */
export function fmtDuracao(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) { const m = min % 60; return m ? `${h}h ${m}m` : `${h}h` }
  const d = Math.floor(h / 24)
  const hr = h % 24
  return hr ? `${d}d ${hr}h` : `${d}d`
}
