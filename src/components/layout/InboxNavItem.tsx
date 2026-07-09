'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getUnreadCount } from '@/app/actions/notifications'
import { playNotifSound } from '@/lib/notif-sound'

export function InboxNavItem({ orgSlug }: { orgSlug: string }) {
  const pathname = usePathname()
  const base = `/${orgSlug}`
  const active = pathname === `${base}/inbox`
  const [unread, setUnread] = useState(0)
  const prevUnread = useRef<number | null>(null)

  const load = useCallback(async () => {
    try {
      const n = await getUnreadCount(orgSlug)
      // Toca o som só quando o contador AUMENTA (chegou nova) — não no 1º load.
      if (prevUnread.current !== null && n > prevUnread.current) playNotifSound()
      prevUnread.current = n
      setUnread(n)
      // Espelha p/ o título da aba (TabUnreadBadge), que soma inbox + chat.
      window.dispatchEvent(new CustomEvent('flow:inbox-unread', { detail: n }))
    } catch { /* tenta de novo no próximo ciclo */ }
  }, [orgSlug])

  // Carrega ao montar, a cada 30s, e ao navegar (ex.: após marcar lidas na página).
  useEffect(() => {
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])
  useEffect(() => { load() }, [pathname, load])

  // A página /inbox avisa na hora ao marcar lidas (senão o badge só caía no
  // próximo poll de 30s — parecia que precisava de F5). Mesmo padrão do chat.
  useEffect(() => {
    function onSet(e: Event) {
      const n = (e as CustomEvent).detail
      if (typeof n === 'number') {
        prevUnread.current = n
        setUnread(n)
        // repassa pro título da aba (TabUnreadBadge soma inbox + chat)
        window.dispatchEvent(new CustomEvent('flow:inbox-unread', { detail: n }))
      }
    }
    window.addEventListener('flow:inbox-unread-set', onSet)
    return () => window.removeEventListener('flow:inbox-unread-set', onSet)
  }, [])

  return (
    <Link
      href={`${base}/inbox`}
      className={cn(
        'flex items-center gap-2.5 mx-2 px-2 py-2 rounded-lg text-sm font-medium transition',
        active ? 'bg-gray-800 text-gray-100' : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800/60'
      )}
    >
      <Inbox className="w-4 h-4 shrink-0" />
      <span className="flex-1">Caixa de entrada</span>
      {unread > 0 && (
        <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-[#fff] text-[10px] font-semibold flex items-center justify-center">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  )
}
