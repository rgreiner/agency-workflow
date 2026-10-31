'use client'

import { useEffect, useRef } from 'react'
import { batimento } from '@/app/actions/heartbeat'
import { tratarErroDePolling } from '@/lib/stale-deploy'
import { PONTO_EVENT } from '@/components/ponto/ponto-sync'
import { HEARTBEAT_EVENT, HEARTBEAT_PEDIDO, type PedidoExtra } from './heartbeat-events'

/**
 * O único timer da aba. A cada 30 s (só com a aba visível) chama `batimento` e
 * publica o resultado em `flow:batimento`; InboxNavItem, ChatDock, PontoGate e
 * PontoPrompt escutam. Substitui 4 timers (12 s, 25 s, 30 s, 60 s) que faziam
 * ~13 pedidos por minuto por aba parada — medido na auditoria de 31/10/2026.
 *
 * Cadência dentro da batida: presença e trava do ponto a cada 2 (60 s); estado
 * completo do ponto a cada 10 (5 min), ou na hora quando alguém bate o ponto
 * (`flow:ponto-atualizado`) ou pede (`pedirBatimento`). A primeira batida leva
 * tudo. Voltar para a aba também bate na hora.
 */
const INTERVALO_MS = 30_000
/** Pedido forçado dentro desta janela depois da última batida é ignorado (rajada de navegação). */
const TRAVA_MS = 3_000
/** Interação (mouse/teclado) mais recente que isto = "ainda aqui" para o histórico de presença. */
const INTERACAO_MS = 5 * 60_000

export function Heartbeat({ orgId, memberIds }: { orgId: string; memberIds: string[] }) {
  const ids = useRef(memberIds)
  useEffect(() => { ids.current = memberIds }, [memberIds])

  useEffect(() => {
    let n = 0
    let ultima = 0
    let emCurso = false
    let lastInput = Date.now()
    const visivel = () => document.visibilityState === 'visible'

    const mark = () => { lastInput = Date.now() }
    const evs: (keyof WindowEventMap)[] = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']
    evs.forEach(e => window.addEventListener(e, mark, { passive: true }))

    async function bater(extra: PedidoExtra = {}, forcado = false) {
      if (!visivel() || emCurso) return
      if (forcado && Date.now() - ultima < TRAVA_MS && !extra.ponto) return
      emCurso = true
      n += 1
      const q = {
        presenca: n % 2 === 1,
        interagiu: Date.now() - lastInput < INTERACAO_MS,
        gate: n % 2 === 1 || !!extra.ponto,
        estado: n % 10 === 1 || !!extra.ponto,
      }
      try {
        const r = await batimento(orgId, ids.current, q)
        ultima = Date.now()
        if (r) window.dispatchEvent(new CustomEvent(HEARTBEAT_EVENT, { detail: r }))
      } catch (e) {
        tratarErroDePolling(e)
      } finally {
        emCurso = false
      }
    }

    bater()
    const t = setInterval(() => bater(), INTERVALO_MS)
    const aoVoltar = () => { if (visivel()) bater({}, true) }
    const aoPedir = (e: Event) => bater((e as CustomEvent<PedidoExtra>).detail ?? {}, true)
    const aoPonto = () => bater({ ponto: true }, true)
    document.addEventListener('visibilitychange', aoVoltar)
    window.addEventListener(HEARTBEAT_PEDIDO, aoPedir)
    window.addEventListener(PONTO_EVENT, aoPonto)
    return () => {
      clearInterval(t)
      evs.forEach(e => window.removeEventListener(e, mark))
      document.removeEventListener('visibilitychange', aoVoltar)
      window.removeEventListener(HEARTBEAT_PEDIDO, aoPedir)
      window.removeEventListener(PONTO_EVENT, aoPonto)
    }
  }, [orgId])

  return null
}
