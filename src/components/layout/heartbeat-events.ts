'use client'

/**
 * Contrato entre o `Heartbeat` (o único timer da aba) e quem exibe os números:
 * InboxNavItem, ChatDock, PontoGate, PontoPrompt. Ninguém mais abre setInterval
 * para falar com o servidor — quem precisa de dado fresco pede uma batida.
 */
import type { Batimento } from '@/app/actions/heartbeat'

export const HEARTBEAT_EVENT = 'flow:batimento'
export const HEARTBEAT_PEDIDO = 'flow:batimento-agora'

export interface PedidoExtra {
  /** Incluir gate + estado do ponto nesta batida (depois de bater o ponto, por exemplo). */
  ponto?: boolean
}

/** Pede ao Heartbeat uma batida agora (com trava de poucos segundos contra rajada). */
export function pedirBatimento(extra: PedidoExtra = {}) {
  try { window.dispatchEvent(new CustomEvent<PedidoExtra>(HEARTBEAT_PEDIDO, { detail: extra })) } catch {}
}

/** Escuta as batidas. Devolve a função de desinscrição. */
export function aoBater(cb: (b: Batimento) => void): () => void {
  const on = (e: Event) => { const b = (e as CustomEvent<Batimento>).detail; if (b) cb(b) }
  window.addEventListener(HEARTBEAT_EVENT, on)
  return () => window.removeEventListener(HEARTBEAT_EVENT, on)
}
