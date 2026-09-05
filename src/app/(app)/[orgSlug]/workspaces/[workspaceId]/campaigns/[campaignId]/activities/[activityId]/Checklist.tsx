'use client'

import { useState, useTransition } from 'react'
import { Check, Plus, Trash2, Loader2, ListChecks, CalendarDays } from 'lucide-react'
import { setActivityChecklist, updateActivityDates } from '@/app/actions/activity'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { lerLinhaComData } from '@/lib/checklist-datas'

/** `data` (YYYY-MM-DD) é opcional: item datado vira linha própria na fila da mídia. */
export interface ChecklistItem { id: string; text: string; done: boolean; data?: string | null }

const fmt = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

export function Checklist({ path, activityId, items: initial, canEdit, dueDate = null, startDate = null }: {
  path: string
  activityId: string
  items: ChecklistItem[]
  canEdit: boolean
  /** Prazo e início da tarefa — só para avisar quando o último item datado passa do prazo. */
  dueDate?: string | null
  startDate?: string | null
}) {
  const [items, setItems] = useState<ChecklistItem[]>(initial)
  const [draft, setDraft] = useState('')
  const [prazo, setPrazo] = useState<string | null>(dueDate)
  const [isPending, startTransition] = useTransition()

  const done = items.filter(i => i.done).length
  const total = items.length
  const pct = total ? Math.round((done / total) * 100) : 0
  const proximo = items.filter(i => !i.done && i.data).map(i => i.data as string).sort()[0] ?? null
  const ultimaData = items.reduce<string | null>(
    (acc, it) => (it.data && (!acc || it.data > acc) ? it.data : acc), null)
  const passaDoPrazo = canEdit && !!ultimaData && !!prazo && ultimaData > prazo

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
  const editData = (id: string, data: string) => persist(items.map(it => it.id === id ? { ...it, data: data || null } : it))

  function add() {
    const t = draft.trim()
    if (!t) return
    const { text, data } = lerLinhaComData(t)
    persist([...items, { id: crypto.randomUUID(), text, done: false, data }])
    setDraft('')
  }

  /** Colar uma lista (uma linha por item, data opcional na frente) cria todos de uma vez. */
  function colar(e: React.ClipboardEvent<HTMLInputElement>) {
    const linhas = e.clipboardData.getData('text').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    if (linhas.length < 2) return
    e.preventDefault()
    const novos = linhas.map(l => {
      const { text, data } = lerLinhaComData(l)
      return { id: crypto.randomUUID(), text, done: false, data }
    })
    persist([...items, ...novos])
    setDraft('')
    const comData = novos.filter(n => n.data).length
    toast.success(`${novos.length} itens adicionados${comData ? ` (${comData} com data)` : ''}.`)
  }

  function ajustarPrazo() {
    if (!ultimaData) return
    startTransition(async () => {
      const r = await updateActivityDates(activityId, startDate, ultimaData)
      if (r?.error) { toast.error(r.error); return }
      setPrazo(ultimaData)
      toast.success(`Prazo da tarefa ajustado para ${fmt(ultimaData)}.`)
    })
  }

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider inline-flex items-center gap-1.5">
          <ListChecks className="w-3.5 h-3.5" /> Checklist
          {total > 0 && <span className="text-gray-400 normal-case tracking-normal font-medium tabular-nums">{done}/{total}</span>}
          {proximo && (
            <span className="text-gray-400 normal-case tracking-normal font-normal tabular-nums">· próximo {fmt(proximo)}</span>
          )}
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
            {canEdit ? (
              <input
                type="date"
                value={it.data ?? ''}
                onChange={e => editData(it.id, e.target.value)}
                aria-label="Data do item"
                title="Data do item (vira linha própria na fila da mídia)"
                className={cn(
                  'shrink-0 w-[7.4rem] bg-transparent text-[11px] tabular-nums rounded-md px-1 py-0.5 focus:outline-none hover:bg-gray-100 transition-colors',
                  it.data ? 'text-gray-500' : 'text-gray-400 opacity-0 group-hover:opacity-100 focus:opacity-100',
                )}
              />
            ) : it.data ? (
              <span className="shrink-0 text-[11px] tabular-nums text-gray-400 inline-flex items-center gap-1">
                <CalendarDays className="w-3 h-3" /> {fmt(it.data)}
              </span>
            ) : null}
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
            onPaste={colar}
            placeholder="Adicionar item… ou cole uma lista (10/05 Dia das Mães)"
            className="flex-1 min-w-0 bg-transparent text-sm py-1 placeholder-gray-400 focus:outline-none"
          />
        </div>
      )}

      {passaDoPrazo && (
        <p className="mt-2.5 text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5 inline-flex items-center gap-2 flex-wrap">
          O último item ({fmt(ultimaData!)}) passa do prazo da tarefa ({fmt(prazo!)}).
          <button type="button" onClick={ajustarPrazo} disabled={isPending}
            className="font-medium underline underline-offset-2 hover:text-amber-900 disabled:opacity-60">
            Ajustar prazo para {fmt(ultimaData!)}
          </button>
        </p>
      )}

      {total === 0 && !canEdit && <p className="text-sm text-gray-400">Sem itens.</p>}
    </div>
  )
}
