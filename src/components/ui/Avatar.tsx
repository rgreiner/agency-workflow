'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

interface AvatarProps {
  name: string | null
  avatarUrl?: string | null
  size?: 'sm' | 'md'
  className?: string
}

// Cores das iniciais: sem roxo/índigo/violeta (regra da casa — o accent é
// laranja e nada disputa com ele). Hash do nome escolhe uma cor estável.
const COLORS = [
  'bg-orange-500', 'bg-amber-500', 'bg-emerald-500', 'bg-teal-500',
  'bg-cyan-500', 'bg-sky-500', 'bg-rose-500', 'bg-pink-500',
  'bg-lime-600', 'bg-red-500',
]

function colorFromName(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return COLORS[Math.abs(hash) % COLORS.length]
}

export function Avatar({ name, avatarUrl, size = 'sm', className }: AvatarProps) {
  // Foto que não carrega (link antigo, volume fora) cai nas iniciais em vez do
  // ícone de imagem quebrada do navegador.
  const [quebrada, setQuebrada] = useState(false)
  const initials = name ? name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() : '?'
  const color = name ? colorFromName(name) : 'bg-gray-400'
  const sizeClass = size === 'sm' ? 'w-6 h-6 text-xs' : 'w-8 h-8 text-sm'

  if (avatarUrl && !quebrada) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={avatarUrl} alt={name ?? ''} title={name ?? ''} decoding="async"
        onError={() => setQuebrada(true)}
        className={cn('rounded-full ring-2 ring-white object-cover', sizeClass, className)} />
    )
  }

  return (
    <div title={name ?? ''}
      className={cn('rounded-full ring-2 ring-white flex items-center justify-center text-[#fff] font-semibold shrink-0', color, sizeClass, className)}>
      {initials}
    </div>
  )
}

export function AvatarGroup({ users, max = 3 }: { users: ({ full_name: string | null; avatar_url: string | null } | null)[]; max?: number }) {
  // À prova de nulos: perfis podem vir null (RLS/join) — ignora em vez de quebrar.
  const safe = (users ?? []).filter(Boolean) as { full_name: string | null; avatar_url: string | null }[]
  const visible = safe.slice(0, max)
  const rest = safe.length - max

  return (
    <div className="flex -space-x-1.5">
      {visible.map((u, i) => (
        <Avatar key={i} name={u.full_name} avatarUrl={u.avatar_url} />
      ))}
      {rest > 0 && (
        <div className="w-6 h-6 rounded-full ring-2 ring-white bg-gray-200 flex items-center justify-center text-xs text-gray-600 font-medium">
          +{rest}
        </div>
      )}
    </div>
  )
}
