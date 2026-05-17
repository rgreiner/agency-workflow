'use client'

import { useState } from 'react'
import { Globe, Lock, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Member {
  userId: string
  fullName: string | null
  email: string
}

interface Props {
  visibility: 'org' | 'custom'
  sharedMemberIds: string[]
  members: Member[]
  currentUserId: string
  onSave: (visibility: 'org' | 'custom', memberIds: string[]) => Promise<void>
  onClose: () => void
}

export function ShareModal({ visibility, sharedMemberIds, members, currentUserId, onSave, onClose }: Props) {
  const [vis, setVis] = useState<'org' | 'custom'>(visibility)
  const [selected, setSelected] = useState<Set<string>>(new Set(sharedMemberIds))
  const [saving, setSaving] = useState(false)

  function toggle(userId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(userId) ? next.delete(userId) : next.add(userId)
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    await onSave(vis, [...selected])
    setSaving(false)
  }

  const others = members.filter(m => m.userId !== currentUserId)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-gray-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Compartilhamento</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <button
            onClick={() => setVis('org')}
            className={cn(
              'flex items-center gap-3 w-full px-4 py-3 rounded-xl border-2 transition text-left',
              vis === 'org' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'
            )}
          >
            <Globe className={cn('w-5 h-5 shrink-0', vis === 'org' ? 'text-indigo-600' : 'text-gray-400')} />
            <div>
              <p className="text-sm font-medium text-gray-900">Todo o time</p>
              <p className="text-xs text-gray-500">Todos os membros da organização podem ver</p>
            </div>
          </button>

          <button
            onClick={() => setVis('custom')}
            className={cn(
              'flex items-center gap-3 w-full px-4 py-3 rounded-xl border-2 transition text-left',
              vis === 'custom' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'
            )}
          >
            <Lock className={cn('w-5 h-5 shrink-0', vis === 'custom' ? 'text-indigo-600' : 'text-gray-400')} />
            <div>
              <p className="text-sm font-medium text-gray-900">Pessoas específicas</p>
              <p className="text-xs text-gray-500">Somente você e quem você escolher</p>
            </div>
          </button>

          {vis === 'custom' && others.length > 0 && (
            <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
              {others.map(m => (
                <label
                  key={m.userId}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(m.userId)}
                    onChange={() => toggle(m.userId)}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-800">{m.fullName ?? m.email}</p>
                    {m.fullName && <p className="text-xs text-gray-400">{m.email}</p>}
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2 px-5 pb-5">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition disabled:opacity-60"
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
