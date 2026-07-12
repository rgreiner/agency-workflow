'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

const OPTS = [['tudo', 'Tudo'], ['comentarios', 'Comentários'], ['historico', 'Histórico']] as const
type Filtro = typeof OPTS[number][0]

/**
 * Filtra o feed da tarefa por tipo — Tudo, só Comentários ou só Histórico (auditoria
 * de status/campos: "quem mudou o prazo?"). Não re-renderiza o feed (server): apenas
 * alterna `data-feed-filter` no container `#activity-feed`, que esconde por CSS.
 */
export function FeedFilter() {
  const [v, setV] = useState<Filtro>('tudo')
  function pick(next: Filtro) {
    setV(next)
    const el = document.getElementById('activity-feed')
    if (el) el.dataset.feedFilter = next
  }
  return (
    <div className="inline-flex bg-gray-100 rounded-lg p-0.5">
      {OPTS.map(([val, label]) => (
        <button key={val} type="button" onClick={() => pick(val)} aria-pressed={v === val}
          className={cn('px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
            v === val ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
          {label}
        </button>
      ))}
    </div>
  )
}
