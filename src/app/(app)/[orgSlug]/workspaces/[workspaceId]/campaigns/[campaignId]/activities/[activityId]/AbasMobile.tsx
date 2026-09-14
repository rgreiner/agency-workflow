'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Aba = 'tarefa' | 'comentarios' | 'historico'

interface Props {
  /** Nº de comentários no feed (badge da aba). */
  comentarios: number
  /** Nº de movimentações de status/campo (badge da aba). */
  historico: number
  tarefa: ReactNode
  atividade: ReactNode
}

/**
 * Celular/tablet: o detalhe da tarefa em abas, em vez das duas colunas empilhadas.
 *
 * Empilhadas, a coluna da direita ficava com altura própria e o feed tomava a
 * tela: os campos e o título ficavam espremidos atrás dos comentários e nada
 * rolava direito. Aqui só um painel aparece por vez e cada um rola por dentro,
 * então nenhum domina o outro.
 *
 * No lg+ nada muda — as duas colunas lado a lado, como sempre.
 *
 * As abas Comentários/Histórico reaproveitam o filtro do feed: escrevem o mesmo
 * `data-feed-filter` que o FeedFilter usa no desktop (regras em globals.css).
 */
export function AbasMobile({ comentarios, historico, tarefa, atividade }: Props) {
  const [aba, setAba] = useState<Aba>('tarefa')

  useEffect(() => {
    if (aba === 'tarefa') return
    const el = document.getElementById('activity-feed')
    if (!el) return
    el.dataset.feedFilter = aba
    // Abrir no fim (últimos registros): o ScrollFeedBottom não alcança enquanto
    // a coluna está escondida — scrollHeight de elemento oculto é 0.
    el.scrollTop = el.scrollHeight
  }, [aba])

  const abas: [Aba, string, number][] = [
    ['tarefa', 'Tarefa', 0],
    ['comentarios', 'Comentários', comentarios],
    ['historico', 'Histórico', historico],
  ]

  return (
    <>
      {/* Abas — só no celular/tablet */}
      <div className="lg:hidden shrink-0 border-b border-gray-200 bg-white px-3 py-2">
        <div className="flex gap-1 rounded-xl bg-gray-100 p-1">
          {abas.map(([val, label, n]) => (
            <button
              key={val}
              type="button"
              aria-pressed={aba === val}
              onClick={() => setAba(val)}
              className={cn(
                'press flex-1 min-w-0 h-9 inline-flex items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium',
                aba === val ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500',
              )}
            >
              <span className="truncate">{label}</span>
              {n > 0 && (
                <span
                  className={cn(
                    'shrink-0 rounded-full px-1.5 text-[10px] font-semibold tabular-nums',
                    aba === val ? 'bg-orange-100 text-orange-700' : 'bg-gray-200 text-gray-500',
                  )}
                >
                  {n}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-1 flex-col lg:flex-row overflow-hidden min-h-0">
        {/* Tarefa — título, campos, checklist */}
        <div className={cn('flex-1 min-h-0 overflow-y-auto', aba !== 'tarefa' && 'max-lg:hidden')}>
          {tarefa}
        </div>

        {/* Atividade — comentários e histórico */}
        <div
          className={cn(
            'flex w-full flex-1 min-h-0 flex-col bg-gray-50/40 lg:w-[360px] lg:flex-none lg:border-l lg:border-gray-200',
            aba === 'tarefa' && 'max-lg:hidden',
          )}
        >
          {atividade}
        </div>
      </div>
    </>
  )
}
