'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { useStatusConfig } from '@/components/ui/StatusBadge'
import { updateActivityStatus } from '@/app/actions/activity'
import { cn } from '@/lib/utils'
import { ChevronDown, Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface Props {
  activityId: string
  currentStatus: string
  path: string
  compact?: boolean
}

export function StatusChanger({ activityId, currentStatus, path, compact }: Props) {
  const [selected, setSelected] = useState(currentStatus)
  const [comment, setComment] = useState('')
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const ref = useRef<HTMLDivElement>(null)

  const statusConfig = useStatusConfig()
  const selectedCfg = statusConfig.find(s => s.value === selected)!
  const changed = selected !== currentStatus

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function handleSave() {
    if (!changed) return
    startTransition(async () => {
      const result = await updateActivityStatus(path, activityId, selected, comment)
      if (result?.error) {
        toast.error(result.error)
      } else {
        setComment('')
        setOpen(false)
        toast.success(`Status: ${statusConfig.find(s => s.value === selected)?.label}`)
      }
    })
  }

  // ── Compact inline mode ──────────────────────────────────────────────
  if (compact) {
    return (
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`Status: ${selectedCfg.label} — alterar`}
          style={{ backgroundColor: selectedCfg.bg, color: selectedCfg.text }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition"
        >
          {isPending ? <Loader2 aria-hidden className="w-3 h-3 animate-spin" /> : null}
          {selectedCfg.label}
          <ChevronDown aria-hidden className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} />
        </button>

        {open && (
          <div className="pop-in absolute top-full mt-1.5 left-0 w-64 bg-white rounded-xl border border-gray-200 shadow-lg z-50 overflow-hidden">
            <div className="max-h-64 overflow-y-auto">
              {['internal', 'external', 'done'].map(group => {
                const label = group === 'internal' ? 'Trabalho interno' : group === 'external' ? 'Cliente / Fornecedores' : 'Encerrado'
                return (
                  <div key={group}>
                    <p className="px-4 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">{label}</p>
                    {statusConfig.filter(s => s.group === group).map(s => (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => setSelected(s.value)}
                        className="w-full text-left px-4 py-2.5 flex items-center gap-2 hover:bg-gray-50 transition"
                      >
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold flex-1" style={{ backgroundColor: s.bg, color: s.text }}>
                          {s.label}
                        </span>
                        {selected === s.value && <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>

            {changed && (
              <div className="border-t border-gray-100 p-3 space-y-2">
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSave() }
                  }}
                  placeholder="Observação (opcional)... Enter confirma"
                  rows={2}
                  autoFocus
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
                <button
                  onClick={handleSave}
                  disabled={isPending}
                  className="w-full py-2 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 transition disabled:opacity-40"
                >
                  {isPending ? 'Salvando…' : 'Confirmar status'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── Full card mode (kept for backward compat) ───────────────────────
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Avançar status</p>

      <div className="relative mb-3">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          style={{ backgroundColor: selectedCfg.bg, color: selectedCfg.text }}
          className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-transparent text-sm font-medium transition"
        >
          {selectedCfg.label}
          <ChevronDown className={cn('w-4 h-4 transition-transform', open && 'rotate-180')} />
        </button>

        {open && (
          <div className="pop-in absolute top-full mt-1 left-0 right-0 bg-white rounded-xl border border-gray-200 shadow-lg z-10 overflow-hidden max-h-72 overflow-y-auto">
            {['internal', 'external', 'done'].map(group => {
              const label = group === 'internal' ? 'Trabalho interno' : group === 'external' ? 'Cliente / Fornecedores' : 'Encerrado'
              return (
                <div key={group}>
                  <p className="px-4 py-2 text-xs font-semibold text-gray-500 bg-gray-50">{label}</p>
                  {statusConfig.filter(s => s.group === group).map(s => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => { setSelected(s.value); setOpen(false) }}
                      className={cn('w-full text-left px-4 py-2.5 text-sm transition hover:bg-gray-50', selected === s.value ? 'font-semibold text-gray-900' : 'text-gray-700')}
                    >
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium mr-2" style={{ backgroundColor: s.bg, color: s.text }}>{s.label}</span>
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {changed && (
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="Observação sobre a mudança (opcional)..."
          rows={2}
          className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-700 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none mb-3"
        />
      )}

      <button
        onClick={handleSave}
        disabled={!changed || isPending}
        className="w-full py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isPending ? 'Salvando...' : 'Salvar status'}
      </button>
    </div>
  )
}
