'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { Repeat, Loader2, Infinity as InfinityIcon, Check, ChevronDown } from 'lucide-react'
import { setActivityRecurrence } from '@/app/actions/activity'
import { useStatusConfig } from '@/components/ui/StatusBadge'
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
  resetStatus: string | null
  canEdit: boolean
}

interface State { enabled: boolean; freq: string; noLimit: boolean; count: number; resetStatus: string }

export function RecurrenceEditor({ activityId, path, recurrence, remaining, resetStatus, canEdit }: Props) {
  const [open, setOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const popupRef = useRef<HTMLDivElement>(null)

  const statusConfig = useStatusConfig()
  // Status candidatos a "volta para" — exclui os de encerramento (Concluído).
  const resetOptions = statusConfig.filter(s => s.group !== 'done')

  // Estado local; só persiste ao FECHAR a box (não a cada mudança) — assim dá
  // pra ajustar os 3-4 itens sem a box fechar a cada alteração (cada save
  // revalida e o pai remonta via `key`).
  // Props são estáveis por montagem (o pai remonta via `key` ao revalidar).
  const initialState: State = {
    enabled: !!recurrence,
    freq: recurrence || 'monthly',
    noLimit: recurrence ? remaining == null : false,
    count: remaining ?? 12,
    resetStatus: resetStatus || 'briefing',
  }
  const [state, setState] = useState<State>(initialState)
  const stateRef = useRef(state)
  function update(next: State) { stateRef.current = next; setState(next) }

  function persist(s: State) {
    startTransition(async () => {
      const result = await setActivityRecurrence(
        path,
        activityId,
        s.enabled ? s.freq : null,
        s.enabled ? (s.noLimit ? null : Math.max(1, s.count)) : null,
        s.enabled ? s.resetStatus : null,
      )
      if (result?.error) toast.error(result.error)
    })
  }
  function changed(a: State, b: State) {
    return a.enabled !== b.enabled || a.freq !== b.freq || a.noLimit !== b.noLimit
      || a.count !== b.count || a.resetStatus !== b.resetStatus
  }
  function closeAndSave() {
    setOpen(false); setStatusOpen(false)
    const s = stateRef.current
    if (changed(s, initialState)) persist(s)
  }

  // Fecha (e salva) ao clicar fora
  useEffect(() => {
    if (!open) return
    function onOut(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) closeAndSave()
    }
    document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const resetCfg = statusConfig.find(s => s.value === state.resetStatus)

  // ── Não-editável: só mostra o selo quando há recorrência ──
  if (!canEdit) {
    if (!recurrence) return null
    return (
      <span className="flex items-center gap-1.5 text-xs bg-orange-50 border border-orange-100 text-orange-700 rounded-lg px-3 py-1.5">
        <Repeat className="w-3.5 h-3.5 shrink-0" />
        {FREQ_LABEL[recurrence] ?? 'Recorrente'} · {remaining == null ? '∞' : `${remaining}x`}
      </span>
    )
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (open ? closeAndSave() : setOpen(true))}
        title="Recorrência do prazo"
        className={cn(
          'flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 transition',
          state.enabled
            ? 'bg-orange-50 border border-orange-200 text-orange-700 hover:bg-orange-100'
            : 'bg-gray-50 border border-gray-200 text-gray-400 hover:border-orange-300 hover:bg-orange-50',
        )}
      >
        <Repeat className="w-3.5 h-3.5 shrink-0" />
        {state.enabled
          ? <span>{FREQ_LABEL[state.freq]} · {state.noLimit ? '∞' : `${state.count}x`}</span>
          : <span>Repetir</span>}
        {isPending && <Loader2 className="w-3 h-3 text-orange-500 animate-spin shrink-0" />}
      </button>

      {open && (
        <div
          ref={popupRef}
          onClick={e => e.stopPropagation()}
          className="pop-in absolute top-full left-0 mt-1 z-50 bg-white rounded-2xl border border-gray-200 shadow-xl p-4"
          style={{ width: 272 }}
        >
          {/* Toggle "é recorrente" */}
          <button
            type="button"
            onClick={() => update({ ...state, enabled: !state.enabled })}
            className="flex items-center gap-2.5 w-full text-left"
          >
            <span className={cn(
              'w-9 h-5 rounded-full flex items-center px-0.5 transition shrink-0',
              state.enabled ? 'bg-orange-600 justify-end' : 'bg-gray-200 justify-start',
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
                  onChange={v => update({ ...state, freq: v })}
                  options={FREQ_OPTIONS}
                  size="sm"
                />
              </div>

              {/* Volta para (status) */}
              <div className="relative">
                <label className="block text-xs text-gray-500 mb-1">Volta para</label>
                <button
                  type="button"
                  onClick={() => setStatusOpen(o => !o)}
                  className="w-full flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-2 py-1.5 hover:border-orange-300 transition"
                >
                  {resetCfg
                    ? <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: resetCfg.bg, color: resetCfg.text }}>{resetCfg.label}</span>
                    : <span className="text-xs text-gray-400">Selecionar</span>}
                  <ChevronDown className={cn('w-3.5 h-3.5 text-gray-400 transition-transform', statusOpen && 'rotate-180')} />
                </button>
                {statusOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 z-10 bg-white rounded-xl border border-gray-200 shadow-lg max-h-56 overflow-y-auto py-1">
                    {resetOptions.map(s => (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => { setStatusOpen(false); update({ ...state, resetStatus: s.value }) }}
                        className="w-full text-left px-2.5 py-1.5 flex items-center gap-2 hover:bg-gray-50 transition-colors"
                      >
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: s.bg, color: s.text }}>{s.label}</span>
                        {state.resetStatus === s.value && <Check className="w-3.5 h-3.5 text-gray-400 ml-auto shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}
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
                    onChange={e => update({ ...state, count: Math.max(1, Number(e.target.value) || 1) })}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); closeAndSave() } }}
                    className="w-16 text-sm border border-gray-200 rounded-lg px-2 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:bg-gray-50 disabled:text-gray-300"
                  />
                  <span className="text-sm text-gray-500">vezes</span>
                  <button
                    type="button"
                    onClick={() => update({ ...state, noLimit: !state.noLimit })}
                    className={cn(
                      'ml-auto flex items-center gap-1 text-xs rounded-lg px-2 py-1.5 transition border',
                      state.noLimit
                        ? 'bg-orange-50 border-orange-200 text-orange-700'
                        : 'bg-white border-gray-200 text-gray-500 hover:border-orange-300',
                    )}
                  >
                    {state.noLimit ? <Check className="w-3 h-3" /> : <InfinityIcon className="w-3.5 h-3.5" />}
                    Sem limite
                  </button>
                </div>
              </div>

              <p className="text-[11px] leading-snug text-gray-400 pt-1">
                Ao concluir, a tarefa volta à pauta no status escolhido com o próximo prazo.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
