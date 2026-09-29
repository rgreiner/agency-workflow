/** Atas de reunião (mig. 306) — tipos compartilhados entre telas e actions. */

export type ResponsavelPasso = 'agencia' | 'cliente'

export interface PassoReuniao {
  /** null = ainda não salvo. */
  id: string | null
  texto: string
  responsavel: ResponsavelPasso
  rascunho: string
  activityId: string | null
}

export interface Reuniao {
  id: string | null
  titulo: string
  realizadaEm: string
  campaignId: string | null
  participantes: string
  notas: string
  transcricao: string
  resumo: string
  publicada: boolean
  passos: PassoReuniao[]
}

/** Tarefa do cliente candidata a vínculo com um passo. */
export interface TarefaVinculavel {
  id: string
  titulo: string
  status: string
  arquivada: boolean
  campaignId: string
  campanha: string
}

/** 2026-09-29 → 29/09/2026 (sem fuso: é data civil). */
export function dataBR(ymd: string | null | undefined): string {
  if (!ymd) return ''
  const [y, m, d] = ymd.slice(0, 10).split('-')
  return d && m && y ? `${d}/${m}/${y}` : ymd
}
