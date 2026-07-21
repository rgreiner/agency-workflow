'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Agrupa movimentações consecutivas (status/campo) do feed atrás de um divisor
 * "ver N movimentações" — o comentário volta a ser o protagonista e a auditoria
 * fica a um clique. Os itens continuam no DOM (só escondidos) para o filtro
 * "Histórico" poder forçar a abertura por CSS (ver globals.css).
 */
export function HistoryGroup({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div data-kind="status" data-history-group="">
      <button
        type="button"
        data-history-toggle=""
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 py-1 text-[11px] text-gray-500 hover:text-gray-700 transition-colors group active:scale-[0.99]"
      >
        <span className="flex-1 h-px bg-gray-200 group-hover:bg-gray-300 transition-colors" />
        <span className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 group-hover:bg-gray-200 transition-colors font-medium">
          <ChevronDown className={cn('w-3 h-3 transition-transform duration-200', open && 'rotate-180')} />
          {open ? 'ocultar' : `ver ${count}`} movimenta{count === 1 ? 'ção' : 'ções'}
        </span>
        <span className="flex-1 h-px bg-gray-200 group-hover:bg-gray-300 transition-colors" />
      </button>
      <div data-history-list="" className={cn('space-y-3', open ? 'pt-2 pb-1' : 'hidden')}>
        {children}
      </div>
    </div>
  )
}
