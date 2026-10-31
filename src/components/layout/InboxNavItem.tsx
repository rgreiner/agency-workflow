'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import { aoBater, pedirBatimento } from './heartbeat-events'
import { playNotifSound } from '@/lib/notif-sound'
import { ICONE_TOPO, ICONE_TOPO_ATIVO, ICONE_TOPO_IDLE } from './icone-topo'

/**
 * Item "Caixa de entrada" da sidebar. `compact` = só o ícone com o badge no
 * canto (linha de atalhos do cabeçalho); sem ele, a linha com rótulo.
 * Não consulta nada sozinho: o contador chega pelo `Heartbeat` (batida única
 * da aba, 30 s); ao navegar, pede uma batida para refletir "marcou lidas".
 */
export function InboxNavItem({ orgSlug, compact = false }: { orgSlug: string; compact?: boolean }) {
  const pathname = usePathname()
  const base = `/${orgSlug}`
  const active = pathname === `${base}/inbox`
  const [unread, setUnread] = useState(0)
  const prevUnread = useRef<number | null>(null)

  const aplicar = useCallback((n: number) => {
    // Toca o som só quando o contador AUMENTA (chegou nova) — não no 1º valor.
    if (prevUnread.current !== null && n > prevUnread.current) playNotifSound()
    prevUnread.current = n
    setUnread(n)
    // Espelha p/ o título da aba (TabUnreadBadge), que soma inbox + chat.
    window.dispatchEvent(new CustomEvent('flow:inbox-unread', { detail: n }))
  }, [])

  // O contador vem na batida do Heartbeat (visível a cada 30 s; ao voltar para a
  // aba, na hora). Navegar pede uma batida (ex.: marcou lidas na página) — com a
  // trava de rajada do próprio Heartbeat.
  useEffect(() => aoBater(b => aplicar(b.inbox)), [aplicar])
  useEffect(() => { pedirBatimento() }, [pathname])

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

  if (compact) {
    return (
      <Link
        href={`${base}/inbox`}
        aria-label={unread > 0 ? `Caixa de entrada (${unread} não lidas)` : 'Caixa de entrada'}
        aria-current={active ? 'page' : undefined}
        data-tip={unread > 0 ? `Caixa de entrada · ${unread}` : 'Caixa de entrada'}
        className={cn(ICONE_TOPO, active ? ICONE_TOPO_ATIVO : ICONE_TOPO_IDLE)}
      >
        <Inbox className="w-4 h-4" />
        {unread > 0 && (
          // A CHEGADA anima (badge-in, monta com o primeiro não-lido); a troca do
          // número, não. 10px é o mínimo legível em ClearType.
          <span className="badge-in absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-[#fff] text-[10px] font-semibold tabular-nums flex items-center justify-center ring-2 ring-gray-900">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Link>
    )
  }

  return (
    <Link
      href={`${base}/inbox`}
      className={cn(
        'flex items-center gap-2.5 mx-2 px-2 py-2 rounded-lg text-sm font-medium transition-colors',
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
