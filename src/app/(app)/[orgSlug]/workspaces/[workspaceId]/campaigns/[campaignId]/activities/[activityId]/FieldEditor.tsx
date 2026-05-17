'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
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
  inlineRow?: boolean   // auto-save on blur/Enter, no buttons
}

export function FieldEditor({ activityId, path, field, value, canEdit, type = 'text', options, display, inlineRow }: Props) {
  const [editing, setEditing]   = useState(false)
  const [draft, setDraft]       = useState(value ?? '')
  const [isPending, startTransition] = useTransition()
  const savedRef = useRef(false)  // prevent double-save on blur after Enter

  function open() {
    if (!canEdit) return
    setDraft(value ?? '')
    savedRef.current = false
    setEditing(true)
  }

  function cancel() {
    setEditing(false)
  }

  function save(val?: string) {
    if (savedRef.current) return
    savedRef.current = true
    const finalVal = (val ?? draft) || null
    setEditing(false)
    if (finalVal === value) return   // nothing changed
    startTransition(async () => {
      const result = await updateActivityField(path, activityId, field, finalVal)
      if (result?.error) toast.error(result.error)
    })
  }

  // ── Inline auto-save mode ────────────────────────────────────────────
  if (inlineRow) {
    if (!editing) {
      return (
        <div
          onClick={open}
          className={`flex items-center gap-1.5 group/fe flex-1 min-w-0 rounded px-1 -ml-1 py-0.5 ${canEdit ? 'cursor-pointer hover:bg-indigo-50 transition' : ''}`}
        >
          {display ?? (value
            ? <span className="text-xs text-gray-700">{value}</span>
            : <span className="text-xs text-gray-400 italic">{canEdit ? 'Clique para editar' : '—'}</span>
          )}
          {canEdit && (
            <Pencil className="w-3 h-3 text-gray-300 opacity-0 group-hover/fe:opacity-100 transition shrink-0" />
          )}
          {isPending && <Loader2 className="w-3 h-3 text-indigo-500 animate-spin shrink-0" />}
        </div>
      )
    }

    if (type === 'select' && options) {
      return (
        <InlineSelect
          options={options}
          value={draft}
          onChange={val => { setDraft(val); save(val) }}
          onBlur={() => save()}
          onEscape={cancel}
        />
      )
    }

    return (
      <input
        type={type === 'url' ? 'text' : type}
        value={draft}
        autoFocus
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); save() }
          if (e.key === 'Escape') cancel()
        }}
        onBlur={() => save()}
        className="flex-1 min-w-0 text-xs border border-indigo-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
        placeholder={type === 'url' ? 'https://' : ''}
      />
    )
  }

  // ── Standard mode (with save/cancel buttons) ─────────────────────────
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
        onClick={() => save()}
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

// Dropdown que fecha sozinho ao selecionar ou perder foco
function InlineSelect({ options, value, onChange, onBlur, onEscape }: {
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
  onBlur: () => void
  onEscape: () => void
}) {
  const ref = useRef<HTMLSelectElement>(null)

  useEffect(() => { ref.current?.focus() }, [])

  return (
    <select
      ref={ref}
      value={value}
      autoFocus
      onChange={e => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={e => { if (e.key === 'Escape') onEscape() }}
      className="flex-1 min-w-0 text-xs border border-indigo-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}
