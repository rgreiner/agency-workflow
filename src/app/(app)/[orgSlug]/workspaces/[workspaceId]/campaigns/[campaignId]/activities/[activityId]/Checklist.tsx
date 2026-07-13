'use client'

import { useState, useTransition } from 'react'
import { Check, Plus, Trash2, Loader2, ListChecks } from 'lucide-react'
import { setActivityChecklist } from '@/app/actions/activity'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

export interface ChecklistItem { id: string; text: string; done: boolean }

export function Checklist({ path, activityId, items: initial, canEdit }: {
  path: string
  activityId: string
  items: ChecklistItem[]
  canEdit: boolean
}) {
  const [items, setItems] = useState<ChecklistItem[]>(initial)
  const [draft, setDraft] = useState('')
  const [isPending, startTransition] = useTransition()

  const done = items.filter(i => i.done).length
  const total = items.length
  const pct = total ? Math.round((done / total) * 100) : 0

  function persist(next: ChecklistItem[]) {
    setItems(next)
    startTransition(async () => {
      const r = await setActivityChecklist(path, activityId, next)
      if (r?.error) toast.error(r.error)
    })
  }
  const toggle = (id: string) => persist(items.map(it => it.id === id ? { ...it, done: !it.done } : it))
  const remove = (id: string) => persist(items.filter(it => it.id !== id))
  const editText = (id: string, text: string) => setItems(items.map(it => it.id === id ? { ...it, text } : it))
  function add() {
    const t = draft.trim()
    if (!t) return
    persist([...items, { id: crypto.randomUUID(), text: t, done: false }])
    setDraft('')
  }

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider inline-flex items-center gap-1.5">
          <ListChecks className="w-3.5 h-3.5" /> Checklist
          {total > 0 && <span className="text-gray-400 normal-case tracking-normal font-medium tabular-nums">{done}/{total}</span>}
        </p>
        {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-300" />}
      </div>

      {total > 0 && (
        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden mb-3">
          <div className="h-full bg-orange-500 transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      )}

      <div className="space-y-1">
        {items.map(it => (
          <div key={it.id} className="flex items-center gap-2.5 group rounded-lg px-1 -mx-1 hover:bg-gray-50/70">
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => toggle(it.id)}
              aria-label={it.done ? 'Desmarcar' : 'Marcar como feito'}
              className={cn(
                'w-4 h-4 rounded-[5px] border shrink-0 flex items-center justify-center transition active:scale-90',
                it.done ? 'bg-orange-500 border-orange-500 text-[#fff]' : 'border-gray-300 hover:border-orange-400',
                !canEdit && 'cursor-default',
              )}
            >
              {it.done && <Check className="w-3 h-3" strokeWidth={3} />}
            </button>
            {canEdit ? (
              <input
                value={it.text}
                onChange={e => editText(it.id, e.target.value)}
                onBlur={() => persist(items)}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                className={cn(
                  'flex-1 min-w-0 bg-transparent text-sm py-1 focus:outline-none border-b border-transparent focus:border-gray-200',
                  it.done && 'line-through text-gray-400',
                )}
              />
            ) : (
              <span className={cn('flex-1 min-w-0 text-sm py-1', it.done && 'line-through text-gray-400')}>{it.text}</span>
            )}
            {canEdit && (
              <button aria-label="Remover" onClick={() => remove(it.id)}
                className="text-gray-300 hover:text-red-500 transition shrink-0 opacity-0 group-hover:opacity-100">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {canEdit && (
        <div className="flex items-center gap-2 mt-1.5 pl-[1px]">
          <Plus className="w-3.5 h-3.5 text-gray-300 shrink-0" />
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
            onBlur={add}
            placeholder="Adicionar item…"
            className="flex-1 min-w-0 bg-transparent text-sm py-1 placeholder-gray-400 focus:outline-none"
          />
        </div>
      )}

      {total === 0 && !canEdit && <p className="text-sm text-gray-400">Sem itens.</p>}
    </div>
  )
}
