'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Briefcase, Clock, Inbox, Menu, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Barra inferior do celular (< md). No celular a casca serve ao trabalho —
 * a fila (Trabalhar), a Caixa, o ponto, a busca e o Menu (abre o drawer com
 * o resto). Substitui o hambúrguer fixo e a faixa vazia de 48px no topo.
 *
 * Some no detalhe da tarefa, que tem a própria barra de status no rodapé
 * (MobileStatusBar): duas barras empilhadas seriam 120px de chrome. A altura
 * está em --barra-inferior (globals.css) para a bolha do chat, o lembrete de
 * ponto e os toasts subirem acima dela.
 */
export function MobileTabBar({ orgSlug, onMenu, onSearch }: {
  orgSlug: string
  onMenu: () => void
  onSearch: () => void
}) {
  const pathname = usePathname()
  const base = `/${orgSlug}`
  const [unread, setUnread] = useState(0)

  // Mesmo contador que a Caixa da sidebar emite (InboxNavItem).
  useEffect(() => {
    const on = (e: Event) => setUnread((e as CustomEvent<number>).detail ?? 0)
    window.addEventListener('flow:inbox-unread', on as EventListener)
    return () => window.removeEventListener('flow:inbox-unread', on as EventListener)
  }, [])

  if (pathname.includes('/activities/')) return null

  const abas = [
    { id: 'trabalhar', label: 'Trabalhar', icon: Briefcase, href: `${base}/views/atendimento`, ativo: pathname.startsWith(`${base}/views/atendimento`) },
    { id: 'inbox',     label: 'Caixa',     icon: Inbox,     href: `${base}/inbox`,             ativo: pathname === `${base}/inbox`, badge: unread },
    { id: 'ponto',     label: 'Ponto',     icon: Clock,     href: `${base}/ponto`,             ativo: pathname.startsWith(`${base}/ponto`) },
  ]
  const ABA = 'press flex-1 flex flex-col items-center justify-center gap-1 h-14 text-[10px] font-medium leading-none'
  const IDLE = 'text-gray-500'
  const ATIVO = 'text-orange-600'

  return (
    <nav
      aria-label="Navegação principal"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 flex items-stretch bg-white/95 backdrop-blur border-t border-gray-200"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {abas.map(({ id, label, icon: Icon, href, ativo, badge }) => (
        <Link key={id} href={href} aria-current={ativo ? 'page' : undefined} className={cn(ABA, ativo ? ATIVO : IDLE)}>
          <span className="relative">
            <Icon className="w-5 h-5" />
            {!!badge && (
              <span className="badge-in absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-[#fff] text-[10px] font-semibold tabular-nums flex items-center justify-center ring-2 ring-white">
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </span>
          {label}
        </Link>
      ))}
      <button type="button" onClick={onSearch} className={cn(ABA, IDLE)}>
        <Search className="w-5 h-5" />
        Buscar
      </button>
      <button type="button" onClick={onMenu} aria-label="Abrir menu" className={cn(ABA, IDLE)}>
        <Menu className="w-5 h-5" />
        Menu
      </button>
    </nav>
  )
}
