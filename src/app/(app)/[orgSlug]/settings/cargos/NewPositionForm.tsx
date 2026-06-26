'use client'

import { useState, useTransition } from 'react'
import { STATUS_CONFIG } from '@/types'
import { createPosition } from '@/app/actions/settings'
import { Plus, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Props {
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

export function NewPositionForm({ orgSlug }: Props) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState('#6366f1')
  const [selected, setSelected] = useState<string[]>([])
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

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

  function handleSubmit() {
    if (!name.trim()) { setError('Nome obrigatório'); return }
    setError('')
    const fd = new FormData()
    fd.append('name', name.trim())
    fd.append('color', color)
    selected.forEach(s => fd.append('statuses', s))
    startTransition(async () => {
      const res = await createPosition(orgSlug, fd)
      if (res?.error) {
        setError(res.error)
        toast.error(res.error)
      } else {
        setName('')
        setColor('#6366f1')
        setSelected([])
        setOpen(false)
        toast.success('Cargo criado!')
      }
    })
  }

  const groups = ['internal', 'external', 'done'] as const

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-gray-200 text-sm text-gray-400 hover:border-orange-300 hover:text-orange-600 transition"
      >
        <Plus className="w-4 h-4" />
        Novo cargo
      </button>
    )
  }

  return (
    <div className="bg-white rounded-xl border-2 border-orange-200 overflow-hidden">
      <div className="px-4 py-3 bg-orange-50 border-b border-orange-100">
        <p className="text-sm font-medium text-orange-700">Novo cargo</p>
      </div>

      <div className="px-4 py-4 space-y-4">
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
              placeholder="Ex: Redação, Design, Atendimento..."
              autoFocus
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500 "
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
            Status que pode movimentar{' '}
            <span className="text-gray-400 font-normal">({selected.length} selecionados)</span>
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
                          ? 'bg-orange-600 border-orange-600'
                          : someChecked
                          ? 'bg-orange-200 border-orange-400'
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
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            onClick={() => { setOpen(false); setName(''); setSelected([]); setError('') }}
            disabled={isPending}
            className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 transition disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-orange-600 text-[#fff] text-xs font-medium rounded-lg hover:bg-orange-700 transition disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            Criar cargo
          </button>
        </div>
      </div>
    </div>
  )
}
