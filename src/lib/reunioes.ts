/** Atas de reunião (mig. 306) — tipos compartilhados entre telas e actions. */

export type ResponsavelPasso = 'agencia' | 'cliente'

export interface PassoReuniao {
  /** null = ainda não salvo. */
  id: string | null
  texto: string
  responsavel: ResponsavelPasso
  rascunho: string
  activityId: string | null
  /** Orçamento (producao tipo orcamento) ligado ao passo — mig. 307. */
  producaoId: string | null
  /** Consulta/combinado resolvido sem virar trabalho de pauta — mig. 307. */
  feito: boolean
}

/** Link exibido no passo (tarefa ou orçamento). */
export interface LinkPasso { titulo: string; href: string }

/** O passo já tem desfecho: tarefa, orçamento ou marcado como feito. */
export const passoResolvido = (p: { activityId?: string | null; producaoId?: string | null; feito?: boolean }) =>
  !!(p.activityId || p.producaoId || p.feito)

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

/** Orçamento do cliente candidato a vínculo com um passo. */
export interface OrcamentoVinculavel {
  id: string
  numero: string
  titulo: string
  situacao: string
  valor: number
}

/** 2026-09-29 → 29/09/2026 (sem fuso: é data civil). */
export function dataBR(ymd: string | null | undefined): string {
  if (!ymd) return ''
  const [y, m, d] = ymd.slice(0, 10).split('-')
  return d && m && y ? `${d}/${m}/${y}` : ymd
}
