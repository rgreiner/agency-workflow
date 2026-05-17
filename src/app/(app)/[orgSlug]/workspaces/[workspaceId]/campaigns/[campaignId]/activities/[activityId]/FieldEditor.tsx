'use client'

import { useState, useTransition } from 'react'
import { Pencil, Check, X, Loader2 } from 'lucide-react'
import { updateActivityField } from '@/app/actions/activity'
import { toast } from 'sonner'

interface Option { value: string; label: string }

interface Props {
  activityId: string
  path: string
  field: string
  value: string | null
  canEdit: boolean
  type?: 'text' | 'date' | 'number' | 'url' | 'select'
  options?: Option[]
  display?: React.ReactNode
}

export function FieldEditor({ activityId, path, field, value, canEdit, type = 'text', options, display }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [isPending, startTransition] = useTransition()

  function open() { setDraft(value ?? ''); setEditing(true) }
  function cancel() { setEditing(false) }

  function save() {
    startTransition(async () => {
      const result = await updateActivityField(path, activityId, field, draft || null)
      if (result?.error) toast.error(result.error)
      else { toast.success('Salvo!'); setEditing(false) }
    })
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-1 justify-end group/fe">
        {display ?? (value
          ? <span className="text-xs text-gray-700">{value}</span>
          : <span className="text-xs text-gray-300">—</span>
        )}
        {canEdit && (
          <button
            onClick={open}
            className="p-0.5 rounded text-gray-300 hover:text-indigo-500 hover:bg-indigo-50 opacity-0 group-hover/fe:opacity-100 transition shrink-0"
          >
            <Pencil className="w-3 h-3" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 justify-end">
      {type === 'select' && options ? (
        <select
          value={draft}
          onChange={e => setDraft(e.target.value)}
          className="text-xs border border-indigo-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
          autoFocus
        >
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input
          type={type}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
          className="text-xs border border-indigo-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white w-36"
          autoFocus
        />
      )}
      <button
        onClick={save}
        disabled={isPending}
        className="p-0.5 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
      </button>
      <button onClick={cancel} className="p-0.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100">
        <X className="w-3 h-3" />
      </button>
    </div>
  )
}
