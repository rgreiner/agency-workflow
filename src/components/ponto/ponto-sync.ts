'use client'

/**
 * Sincronia entre os componentes de ponto da mesma aba. O lembrete
 * (PontoPrompt) mantém estado próprio e só re-consultava a cada 5 min — quem
 * batia pelo card da home continuava vendo o banner "trabalhando sem ponto".
 * Toda batida bem-sucedida anuncia aqui; quem exibe estado do ponto escuta.
 */
export const PONTO_EVENT = 'flow:ponto-atualizado'

export function anunciarPonto() {
  try { window.dispatchEvent(new Event(PONTO_EVENT)) } catch {}
}
