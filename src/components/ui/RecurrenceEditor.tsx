'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { Repeat, Loader2, Infinity as InfinityIcon, Check } from 'lucide-react'
import { setActivityRecurrence } from '@/app/actions/activity'
import { Select } from '@/components/ui/Select'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// Frequências disponíveis (value casa com a RPC recurrence_interval no banco).
const FREQ_OPTIONS = [
  { value: 'weekly',     label: 'Semanal'   },
  { value: 'monthly',    label: 'Mensal'    },
  { value: 'bimonthly',  label: 'Bimestral' },
  { value: 'quarterly',  label: 'Trimestral'},
  { value: 'semiannual', label: 'Semestral' },
  { value: 'annual',     label: 'Anual'     },
]
const FREQ_LABEL: Record<string, string> = Object.fromEntries(FREQ_OPTIONS.map(o => [o.value, o.label]))

interface Props {
  activityId: string
  path: string
  recurrence: string | null
  remaining: number | null
  canEdit: boolean
}

interface State { enabled: boolean; freq: string; noLimit: boolean; count: number }

export function RecurrenceEditor({ activityId, path, recurrence, remaining, canEdit }: Props) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const popupRef = useRef<HTMLDivElement>(null)

  // Estado inicial vem das props; o pai passa um `key` que muda quando o servidor
  // revalida, remontando o componente com os novos valores (sem efeito de sync).
  const [state, setState] = useState<State>({
    enabled: !!recurrence,
    freq: recurrence || 'monthly',
    noLimit: recurrence ? remaining == null : false,
    count: remaining ?? 12,
  })

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return
    function onOut(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [open])

  function save(next: State) {
    setState(next)
    startTransition(async () => {
      const result = await setActivityRecurrence(
        path,
        activityId,
        next.enabled ? next.freq : null,
        next.enabled ? (next.noLimit ? null : Math.max(1, next.count)) : null,
      )
      if (result?.error) toast.error(result.error)
    })
  }

  // ── Não-editável: só mostra o selo quando há recorrência ──
  if (!canEdit) {
    if (!recurrence) return null
    return (
      <span className="flex items-center gap-1.5 text-xs bg-indigo-50 border border-indigo-100 text-indigo-700 rounded-lg px-3 py-1.5">
        <Repeat className="w-3.5 h-3.5 shrink-0" />
        {FREQ_LABEL[recurrence] ?? 'Recorrente'} · {remaining == null ? '∞' : `${remaining}x`}
      </span>
    )
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Recorrência do prazo"
        className={cn(
          'flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 transition',
          state.enabled
            ? 'bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100'
            : 'bg-gray-50 border border-gray-200 text-gray-400 hover:border-indigo-300 hover:bg-indigo-50',
        )}
      >
        <Repeat className="w-3.5 h-3.5 shrink-0" />
        {state.enabled
          ? <span>{FREQ_LABEL[state.freq]} · {state.noLimit ? '∞' : `${state.count}x`}</span>
          : <span>Repetir</span>}
        {isPending && <Loader2 className="w-3 h-3 text-indigo-500 animate-spin shrink-0" />}
      </button>

      {open && (
        <div
          ref={popupRef}
          onClick={e => e.stopPropagation()}
          className="absolute top-full left-0 mt-1 z-50 bg-white rounded-2xl border border-gray-200 shadow-xl p-4"
          style={{ width: 264 }}
        >
          {/* Toggle "é recorrente" */}
          <button
            type="button"
            onClick={() => save({ ...state, enabled: !state.enabled })}
            className="flex items-center gap-2.5 w-full text-left"
          >
            <span className={cn(
              'w-9 h-5 rounded-full flex items-center px-0.5 transition shrink-0',
              state.enabled ? 'bg-indigo-600 justify-end' : 'bg-gray-200 justify-start',
            )}>
              <span className="w-4 h-4 rounded-full bg-white shadow" />
            </span>
            <span className="text-sm font-medium text-gray-800">Prazo recorrente</span>
          </button>

          {state.enabled && (
            <div className="mt-4 space-y-3">
              {/* Frequência */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Frequência</label>
                <Select
                  value={state.freq}
                  onChange={v => save({ ...state, freq: v })}
                  options={FREQ_OPTIONS}
                  size="sm"
                />
              </div>

              {/* Repetições */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Repetir</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    value={state.noLimit ? '' : state.count}
                    disabled={state.noLimit}
                    onChange={e => setState(s => ({ ...s, count: Math.max(1, Number(e.target.value) || 1) }))}
                    onBlur={() => !state.noLimit && save(state)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(state); setOpen(false) } }}
                    className="w-16 text-sm border border-gray-200 rounded-lg px-2 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-300"
                  />
                  <span className="text-sm text-gray-500">vezes</span>
                  <button
                    type="button"
                    onClick={() => save({ ...state, noLimit: !state.noLimit })}
                    className={cn(
                      'ml-auto flex items-center gap-1 text-xs rounded-lg px-2 py-1.5 transition border',
                      state.noLimit
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                        : 'bg-white border-gray-200 text-gray-500 hover:border-indigo-300',
                    )}
                  >
                    {state.noLimit ? <Check className="w-3 h-3" /> : <InfinityIcon className="w-3.5 h-3.5" />}
                    Sem limite
                  </button>
                </div>
              </div>

              <p className="text-[11px] leading-snug text-gray-400 pt-1">
                Ao concluir, a tarefa volta à pauta com o próximo prazo.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
