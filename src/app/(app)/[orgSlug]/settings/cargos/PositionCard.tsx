'use client'

import { useState, useTransition } from 'react'
import { STATUS_CONFIG } from '@/types'
import { updatePosition, deletePosition } from '@/app/actions/settings'
import { ChevronDown, ChevronUp, Trash2, Check, Loader2, AlertTriangle, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Props {
  position: {
    id: string
    name: string
    color: string
    allowed_statuses: string[]
  }
  orgSlug: string
}

const GROUP_LABELS = {
  internal: 'Interno',
  external: 'Cliente / Fornecedores',
  done: 'Encerrado',
}

const PRESET_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#06b6d4', '#3b82f6', '#64748b', '#1f2937',
]

export function PositionCard({ position, orgSlug }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [name, setName] = useState(position.name)
  const [color, setColor] = useState(position.color)
  const [selected, setSelected] = useState<string[]>([...position.allowed_statuses])
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isDirty =
    name !== position.name ||
    color !== position.color ||
    JSON.stringify([...selected].sort()) !== JSON.stringify([...position.allowed_statuses].sort())

  function toggleStatus(val: string) {
    setSelected(prev =>
      prev.includes(val) ? prev.filter(s => s !== val) : [...prev, val]
    )
  }

  function toggleGroup(group: string) {
    const groupStatuses = STATUS_CONFIG.filter(s => s.group === group).map(s => s.value as string)
    const allSelected = groupStatuses.every(s => selected.includes(s))
    if (allSelected) {
      setSelected(prev => prev.filter(s => !groupStatuses.includes(s)))
    } else {
      setSelected(prev => [...new Set([...prev, ...groupStatuses])])
    }
  }

  function handleSave() {
    if (!name.trim()) { setError('Nome obrigatório'); return }
    setError('')
    const fd = new FormData()
    fd.append('name', name.trim())
    fd.append('color', color)
    selected.forEach(s => fd.append('statuses', s))
    startTransition(async () => {
      const res = await updatePosition(orgSlug, position.id, fd)
      if (res?.error) {
        setError(res.error)
        toast.error(res.error)
      } else {
        toast.success('Cargo atualizado!')
      }
    })
  }

  function handleDelete() {
    startTransition(async () => {
      const res = await deletePosition(orgSlug, position.id)
      if (res?.error) {
        setError(res.error)
        toast.error(res.error)
      } else {
        toast.success('Cargo excluído.')
      }
    })
  }

  const groups = ['internal', 'external', 'done'] as const

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
        >
          <span
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: color }}
          />
          <span className="text-sm font-medium text-gray-900 truncate">{position.name}</span>
          <span className="text-xs text-gray-400 flex-shrink-0">
            {selected.length} status{selected.length !== 1 ? 'es' : ''}
          </span>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-400 ml-auto flex-shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400 ml-auto flex-shrink-0" />
          )}
        </button>
      </div>

      {/* Expanded form */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-4 space-y-4">
          {error && (
            <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* Name + color */}
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Nome do cargo</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Cor</label>
              <div className="flex gap-1.5 flex-wrap max-w-[180px]">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={cn(
                      'w-6 h-6 rounded-full border-2 transition flex items-center justify-center',
                      color === c ? 'border-gray-400 scale-110' : 'border-transparent hover:scale-105'
                    )}
                    style={{ backgroundColor: c }}
                  >
                    {color === c && (
                      <Check className="w-3 h-3 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Status checkboxes */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">
              Status que pode movimentar
            </label>
            <div className="space-y-3">
              {groups.map(group => {
                const groupStatuses = STATUS_CONFIG.filter(s => s.group === group)
                const allChecked = groupStatuses.every(s => selected.includes(s.value))
                const someChecked = groupStatuses.some(s => selected.includes(s.value))

                return (
                  <div key={group}>
                    <button
                      onClick={() => toggleGroup(group)}
                      className="flex items-center gap-2 text-xs font-medium text-gray-600 mb-1.5 hover:text-gray-900 transition"
                    >
                      <span
                        className={cn(
                          'w-3.5 h-3.5 rounded border flex items-center justify-center',
                          allChecked
                            ? 'bg-indigo-600 border-indigo-600'
                            : someChecked
                            ? 'bg-indigo-200 border-indigo-400'
                            : 'border-gray-300'
                        )}
                      >
                        {(allChecked || someChecked) && (
                          <Check className="w-2.5 h-2.5 text-white" />
                        )}
                      </span>
                      {GROUP_LABELS[group]}
                    </button>
                    <div className="flex flex-wrap gap-1.5 pl-5">
                      {groupStatuses.map(s => {
                        const checked = selected.includes(s.value)
                        return (
                          <button
                            key={s.value}
                            onClick={() => toggleStatus(s.value)}
                            className={cn(
                              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition',
                              checked
                                ? `${s.bgColor} ${s.color} border-transparent`
                                : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'
                            )}
                          >
                            {checked && <Check className="w-2.5 h-2.5" />}
                            {s.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-1">
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                disabled={isPending}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-600 transition disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Excluir cargo
              </button>
            ) : (
              <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-lg px-2.5 py-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                <span className="text-xs text-red-700 font-medium">Excluir cargo?</span>
                <button
                  onClick={handleDelete}
                  disabled={isPending}
                  className="text-xs font-semibold text-red-600 hover:text-red-800 disabled:opacity-50 flex items-center gap-1"
                >
                  {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Confirmar'}
                </button>
                <button aria-label="Fechar" onClick={() => setConfirmDelete(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <button
              onClick={handleSave}
              disabled={isPending || !isDirty}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition',
                isDirty
                  ? 'bg-indigo-600 text-[#fff] hover:bg-indigo-700 disabled:opacity-50'
                  : 'bg-gray-100 text-gray-300 cursor-not-allowed'
              )}
            >
              {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Salvar alterações
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
