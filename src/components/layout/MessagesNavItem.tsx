'use client'

import { useState, useEffect } from 'react'
import { MessagesSquare } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Item "Mensagens" da sidebar: abre/fecha o painel de contatos do ChatDock via
 * evento de janela e mostra o total de não-lidas (emitido pelo ChatDock).
 */
export function MessagesNavItem() {
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    const onUnread = (e: Event) => setUnread((e as CustomEvent<number>).detail ?? 0)
    window.addEventListener('flow:chat-unread', onUnread as EventListener)
    return () => window.removeEventListener('flow:chat-unread', onUnread as EventListener)
  }, [])

  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent('flow:chat-toggle'))}
      className={cn(
        'w-full flex items-center gap-2.5 mx-2 px-2 py-2 rounded-lg text-sm font-medium transition',
        'text-gray-400 hover:text-gray-100 hover:bg-gray-800/60'
      )}
      style={{ width: 'calc(100% - 1rem)' }}
    >
      <MessagesSquare className="w-4 h-4 shrink-0" />
      <span className="flex-1 text-left">Mensagens</span>
      {unread > 0 && (
        <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-[#fff] text-[10px] font-semibold flex items-center justify-center">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  )
}
