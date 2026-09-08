/**
 * Presença diária no Flow (user_presence_dia, mig. 281) formatada pra tela.
 * Módulo puro (sem 'use server'): usado pela action e por páginas server.
 */
export interface PresencaDia { primeiro: string; ultimo: string }

export const hhmmBrasilia = (ts: string) =>
  new Date(ts).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })

/** Linhas da RPC rh_presenca_dias → { 'YYYY-MM-DD': { primeiro, ultimo } } em HH:MM de Brasília. */
export function presencaPorDia(rows: unknown): Record<string, PresencaDia> {
  const porDia: Record<string, PresencaDia> = {}
  for (const r of (rows ?? []) as { dia: string; primeiro_em: string; ultimo_em: string }[]) {
    porDia[r.dia] = { primeiro: hhmmBrasilia(r.primeiro_em), ultimo: hhmmBrasilia(r.ultimo_em) }
  }
  return porDia
}
