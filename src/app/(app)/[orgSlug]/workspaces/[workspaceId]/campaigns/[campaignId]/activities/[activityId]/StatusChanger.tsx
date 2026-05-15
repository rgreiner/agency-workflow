'use client'

import { useState, useTransition } from 'react'
import { STATUS_CONFIG } from '@/types'
import { updateActivityStatus } from '@/app/actions/activity'
import { cn } from '@/lib/utils'
import { ChevronDown } from 'lucide-react'

interface Props {
  activityId: string
  currentStatus: string
  path: string
}

export function StatusChanger({ activityId, currentStatus, path }: Props) {
  const [selected, setSelected] = useState(currentStatus)
  const [comment, setComment] = useState('')
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const selectedCfg = STATUS_CONFIG.find((s) => s.value === selected)!

  function handleSave() {
    if (selected === currentStatus) return
    startTransition(async () => {
      const result = await updateActivityStatus(path, activityId, selected, comment)
      if (result?.error) setError(result.error)
      else { setComment(''); setOpen(false) }
    })
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Avançar status</p>

      {/* Seletor */}
      <div className="relative mb-3">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={cn(
            'w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-medium transition',
            selectedCfg.bgColor, selectedCfg.color, 'border-transparent'
          )}
        >
          {selectedCfg.label}
          <ChevronDown className={cn('w-4 h-4 transition-transform', open && 'rotate-180')} />
        </button>

        {open && (
          <div className="absolute top-full mt-1 left-0 right-0 bg-white rounded-xl border border-gray-200 shadow-lg z-10 overflow-hidden max-h-72 overflow-y-auto">
            {['internal', 'external', 'done'].map((group) => {
              const label = group === 'internal' ? 'Trabalho interno' : group === 'external' ? 'Cliente / Fornecedores' : 'Encerrado'
              return (
                <div key={group}>
                  <p className="px-4 py-2 text-xs font-semibold text-gray-400 bg-gray-50">{label}</p>
                  {STATUS_CONFIG.filter((s) => s.group === group).map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => { setSelected(s.value); setOpen(false) }}
                      className={cn(
                        'w-full text-left px-4 py-2.5 text-sm transition hover:bg-gray-50',
                        selected === s.value ? 'font-semibold text-gray-900' : 'text-gray-700'
                      )}
                    >
                      <span className={cn('inline-flex px-2 py-0.5 rounded-full text-xs font-medium mr-2', s.bgColor, s.color)}>
                        {s.label}
                      </span>
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Comentário opcional */}
      {selected !== currentStatus && (
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Observação sobre a mudança (opcional)..."
          rows={2}
          className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none mb-3"
        />
      )}

      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

      <button
        onClick={handleSave}
        disabled={selected === currentStatus || isPending}
        className="w-full py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isPending ? 'Salvando...' : 'Salvar status'}
      </button>
    </div>
  )
}
