'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { setActivityAssignees } from '@/app/actions/activity'
import { UserPlus, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Member {
  userId: string
  fullName: string | null
  email: string
  avatarUrl: string | null
}

interface Props {
  activityId: string
  currentStatus: string
  assignedIds: string[]
  members: Member[]
  path: string
}

function Avatar({ member, size = 'sm' }: { member: Member; size?: 'sm' | 'md' }) {
  const initials = (member.fullName ?? member.email).charAt(0).toUpperCase()
  const dim = size === 'sm' ? 'w-6 h-6 text-[10px]' : 'w-7 h-7 text-xs'
  return member.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={member.avatarUrl} alt={member.fullName ?? member.email}
      className={cn(dim, 'rounded-full object-cover shrink-0')} />
  ) : (
    <div className={cn(dim, 'rounded-full bg-indigo-100 text-indigo-600 font-semibold flex items-center justify-center shrink-0')}>
      {initials}
    </div>
  )
}

export function AssigneeSelector({ activityId, currentStatus, assignedIds, members, path }: Props) {
  const [selected, setSelected] = useState<string[]>(assignedIds)
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const ref = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function toggle(userId: string) {
    const next = selected.includes(userId)
      ? selected.filter(id => id !== userId)
      : [...selected, userId]

    setSelected(next)
    startTransition(async () => {
      await setActivityAssignees(path, activityId, currentStatus, next)
    })
  }

  const assignedMembers = members.filter(m => selected.includes(m.userId))
  const unassigned = members.filter(m => !selected.includes(m.userId))

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Responsáveis</p>

      <div ref={ref} className="relative">
        {/* Assigned avatars */}
        <div className="flex flex-wrap gap-2 mb-2">
          {assignedMembers.map(m => (
            <div key={m.userId} className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full pl-1 pr-2 py-0.5 group">
              <Avatar member={m} size="sm" />
              <span className="text-xs text-gray-700 font-medium max-w-[80px] truncate">
                {m.fullName ?? m.email.split('@')[0]}
              </span>
              <button
                onClick={() => toggle(m.userId)}
                disabled={isPending}
                className="text-gray-300 hover:text-red-400 transition ml-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}

          {/* Add button */}
          {members.length > selected.length && (
            <button
              onClick={() => setOpen(o => !o)}
              disabled={isPending}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed border-gray-300 text-gray-400 hover:border-indigo-400 hover:text-indigo-500 transition text-xs"
            >
              <UserPlus className="w-3 h-3" />
              {selected.length === 0 ? 'Atribuir' : 'Adicionar'}
            </button>
          )}

          {selected.length === 0 && members.length === 0 && (
            <p className="text-xs text-gray-400">Nenhum membro na organização.</p>
          )}
        </div>

        {/* Dropdown */}
        {open && (
          <div className="absolute left-0 top-full mt-1 w-56 bg-white rounded-xl border border-gray-200 shadow-lg z-10 py-1 max-h-52 overflow-y-auto">
            {unassigned.length === 0 ? (
              <p className="text-xs text-gray-400 px-3 py-2">Todos já atribuídos</p>
            ) : (
              unassigned.map(m => (
                <button
                  key={m.userId}
                  onClick={() => { toggle(m.userId); setOpen(false) }}
                  disabled={isPending}
                  className="flex items-center gap-2.5 w-full px-3 py-2 hover:bg-gray-50 transition text-left"
                >
                  <Avatar member={m} size="md" />
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800 font-medium truncate">
                      {m.fullName ?? m.email.split('@')[0]}
                    </p>
                    <p className="text-xs text-gray-400 truncate">{m.email}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
