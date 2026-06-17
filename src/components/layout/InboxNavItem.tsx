'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getUnreadCount } from '@/app/actions/notifications'

export function InboxNavItem({ orgSlug }: { orgSlug: string }) {
  const pathname = usePathname()
  const base = `/${orgSlug}`
  const active = pathname === `${base}/inbox`
  const [unread, setUnread] = useState(0)

  const load = useCallback(async () => {
    try { setUnread(await getUnreadCount(orgSlug)) } catch { /* tenta de novo no próximo ciclo */ }
  }, [orgSlug])

  // Carrega ao montar, a cada 30s, e ao navegar (ex.: após marcar lidas na página).
  useEffect(() => {
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])
  useEffect(() => { load() }, [pathname, load])

  return (
    <Link
      href={`${base}/inbox`}
      className={cn(
        'flex items-center gap-2.5 mx-2 px-2 py-1.5 rounded-lg text-sm transition',
        active ? 'bg-gray-800 text-gray-100' : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800/60'
      )}
    >
      <Inbox className="w-4 h-4 shrink-0" />
      <span className="flex-1">Caixa de entrada</span>
      {unread > 0 && (
        <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  )
}
