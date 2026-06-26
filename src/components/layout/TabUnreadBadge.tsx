'use client'

import { useEffect, useRef } from 'react'

/**
 * Reflete o total de não-lidas (Caixa de entrada + Mensagens) no título da aba,
 * como "(3) Flow …" — útil quando o Flow está numa aba em 2º plano.
 *
 * Passivo: não faz polling próprio, só ouve os contadores que o InboxNavItem
 * ('flow:inbox-unread') e o ChatDock ('flow:chat-unread') já emitem. Um
 * MutationObserver no <title> reaplica o prefixo quando o Next troca o título ao
 * navegar entre páginas (o template de metadata sobrescreveria o prefixo).
 */
export function TabUnreadBadge() {
  const inbox = useRef(0)
  const chat = useRef(0)

  useEffect(() => {
    const titleEl = document.querySelector('title')
    if (!titleEl) return

    const apply = () => {
      const total = inbox.current + chat.current
      const base = (titleEl.textContent ?? '').replace(/^\(\d+\+?\)\s+/, '')
      const next = total > 0 ? `(${total > 99 ? '99+' : total}) ${base}` : base
      if (titleEl.textContent !== next) titleEl.textContent = next
    }

    const onInbox = (e: Event) => { inbox.current = (e as CustomEvent<number>).detail ?? 0; apply() }
    const onChat = (e: Event) => { chat.current = (e as CustomEvent<number>).detail ?? 0; apply() }
    window.addEventListener('flow:inbox-unread', onInbox as EventListener)
    window.addEventListener('flow:chat-unread', onChat as EventListener)

    // Reaplica o prefixo quando o Next reescreve o <title> (navegação).
    const obs = new MutationObserver(apply)
    obs.observe(titleEl, { childList: true, characterData: true, subtree: true })
    apply()

    return () => {
      window.removeEventListener('flow:inbox-unread', onInbox as EventListener)
      window.removeEventListener('flow:chat-unread', onChat as EventListener)
      obs.disconnect()
    }
  }, [])

  return null
}
