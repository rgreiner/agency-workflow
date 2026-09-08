'use client'

/**
 * Seletor de membros em chips — responsáveis da tarefa (criação) e equipe do
 * cliente (cadastro). `showError` pinta em vermelho quando a escolha é
 * obrigatória e falta; `atalhoEu` mostra o botão "Eu" pra se assumir num clique.
 */
import { useEffect, useRef, useState } from 'react'
import { UserPlus, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface MembroSelecionavel {
  userId: string
  fullName: string | null
  email: string
  avatarUrl: string | null
}

export function MembroAvatar({ member, size = 'sm' }: { member: MembroSelecionavel; size?: 'sm' | 'md' }) {
  const initials = (member.fullName ?? member.email).charAt(0).toUpperCase()
  const dim = size === 'sm' ? 'w-6 h-6 text-[10px]' : 'w-7 h-7 text-xs'
  return member.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={member.avatarUrl} alt={member.fullName ?? member.email}
      className={cn(dim, 'rounded-full object-cover shrink-0')} />
  ) : (
    <div className={cn(dim, 'rounded-full bg-orange-100 text-orange-600 font-semibold flex items-center justify-center shrink-0')}>
      {initials}
    </div>
  )
}

export function MembrosPicker({
  members, currentUserId = null, selected, onChange, showError = false,
  placeholder = 'Escolher responsável', addLabel = 'Adicionar', atalhoEu = true,
}: {
  members: MembroSelecionavel[]
  currentUserId?: string | null
  selected: string[]
  onChange: (ids: string[]) => void
  showError?: boolean
  placeholder?: string
  addLabel?: string
  atalhoEu?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function toggle(userId: string) {
    onChange(selected.includes(userId) ? selected.filter(id => id !== userId) : [...selected, userId])
  }

  const assigned = members.filter(m => selected.includes(m.userId))
  const eu = atalhoEu && currentUserId ? members.find(m => m.userId === currentUserId) : null

  return (
    <div ref={ref} className="relative">
      <div className={cn(
        'w-full rounded-xl border px-3 py-2.5 min-h-[46px] flex flex-wrap items-center gap-2 transition-colors',
        showError ? 'border-red-300 bg-red-50/60 ring-2 ring-red-100' : 'border-transparent bg-gray-100'
      )}>
        {assigned.map(m => (
          <span key={m.userId}
            className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-full pl-1 pr-2 py-0.5">
            <MembroAvatar member={m} size="sm" />
            <span className="text-xs font-medium text-gray-700 max-w-[110px] truncate">
              {m.fullName ?? m.email.split('@')[0]}
            </span>
            <button type="button" onClick={() => toggle(m.userId)}
              aria-label={`Remover ${m.fullName ?? m.email.split('@')[0]}`}
              className="text-gray-400 hover:text-red-400 transition-colors ml-0.5">
              <X aria-hidden className="w-3 h-3" />
            </button>
          </span>
        ))}

        <button type="button" onClick={() => setOpen(o => !o)}
          className={cn(
            'flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed text-xs transition-colors',
            showError
              ? 'border-red-300 text-red-500 hover:border-red-400'
              : 'border-gray-300 text-gray-500 hover:border-orange-400 hover:text-orange-500'
          )}>
          <UserPlus className="w-3 h-3" />
          {selected.length === 0 ? placeholder : addLabel}
        </button>

        {/* Atalho: assumir a tarefa explicitamente, em um clique. */}
        {eu && !selected.includes(eu.userId) && (
          <button type="button" onClick={() => toggle(eu.userId)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-gray-200 bg-white text-xs text-gray-600 hover:border-orange-400 hover:text-orange-600 transition-colors">
            Eu
          </button>
        )}
      </div>

      {open && (
        <div className="pop-in absolute left-0 top-full mt-1 w-64 bg-white rounded-xl border border-gray-200 shadow-lg z-20 py-1 max-h-56 overflow-y-auto">
          {members.length === 0 ? (
            <p className="text-xs text-gray-500 px-3 py-2">Nenhum membro na organização.</p>
          ) : members.map(m => {
            const on = selected.includes(m.userId)
            return (
              <button key={m.userId} type="button"
                onClick={() => toggle(m.userId)}
                className="flex items-center gap-2.5 w-full px-3 py-2 hover:bg-gray-50 transition-colors text-left">
                <MembroAvatar member={m} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-800 font-medium truncate">
                    {m.fullName ?? m.email.split('@')[0]}
                    {m.userId === currentUserId && <span className="text-gray-400 font-normal"> (você)</span>}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{m.email}</p>
                </div>
                <span className={cn('w-4 h-4 rounded border flex items-center justify-center shrink-0',
                  on ? 'bg-orange-600 border-orange-600' : 'border-gray-300')}>
                  {on && <span className="w-1.5 h-1.5 rounded-sm bg-white" />}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
