'use client'

import { useEffect, useRef } from 'react'
import { aplicarBadgeFavicon } from '@/lib/favicon-badge'

/**
 * Reflete o total de não-lidas (Caixa de entrada + Mensagens) em três lugares:
 * - no título da aba, como "(3) Flow …";
 * - no favicon, com a bolinha vermelha por cima do ícone (Gmail/WhatsApp Web);
 * - no ícone do app instalado (PWA), pela Badging API, onde o navegador tem.
 * Útil quando o Flow está numa aba ou janela em 2º plano.
 *
 * Passivo: não faz polling próprio, só ouve os contadores que o InboxNavItem
 * ('flow:inbox-unread') e o ChatDock ('flow:chat-unread') já emitem. Um
 * MutationObserver no <head> reaplica título e favicon quando o Next reescreve
 * o <title> ou recria os <link rel="icon"> ao navegar entre páginas.
 */
export function TabUnreadBadge() {
  const inbox = useRef(0)
  const chat = useRef(0)

  useEffect(() => {
    const total = () => inbox.current + chat.current

    // Título + favicon: idempotente, roda a cada mutação do <head>.
    const apply = () => {
      const n = total()
      const titleEl = document.querySelector('title')
      if (titleEl) {
        const base = (titleEl.textContent ?? '').replace(/^\(\d+\+?\)\s+/, '')
        const next = n > 0 ? `(${n > 99 ? '99+' : n}) ${base}` : base
        if (titleEl.textContent !== next) titleEl.textContent = next
      }
      aplicarBadgeFavicon(n)
    }

    // Ícone do app instalado: só quando o contador muda (na aba comum é no-op).
    // Não roda no mount: o 0 inicial limparia o badge até a 1ª contagem chegar.
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>
      clearAppBadge?: () => Promise<void>
    }
    const badgeApp = () => {
      const n = total()
      const p = n > 0 ? nav.setAppBadge?.(n) : nav.clearAppBadge?.()
      p?.catch(() => { /* sem suporte ou sem permissão: ignora */ })
    }

    const onInbox = (e: Event) => { inbox.current = (e as CustomEvent<number>).detail ?? 0; apply(); badgeApp() }
    const onChat = (e: Event) => { chat.current = (e as CustomEvent<number>).detail ?? 0; apply(); badgeApp() }
    window.addEventListener('flow:inbox-unread', onInbox as EventListener)
    window.addEventListener('flow:chat-unread', onChat as EventListener)

    // Reaplica quando o Next reescreve o <title> ou recria os <link> (navegação).
    // Não observa atributos de propósito: a troca do href do favicon não pode
    // disparar o observer de novo.
    const obs = new MutationObserver(apply)
    obs.observe(document.head, { childList: true, subtree: true, characterData: true })
    apply()

    return () => {
      window.removeEventListener('flow:inbox-unread', onInbox as EventListener)
      window.removeEventListener('flow:chat-unread', onChat as EventListener)
      obs.disconnect()
      aplicarBadgeFavicon(0) // sair do app (logout) devolve o ícone original
    }
  }, [])

  return null
}
