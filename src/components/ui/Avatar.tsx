import { cn } from '@/lib/utils'

interface AvatarProps {
  name: string | null
  avatarUrl?: string | null
  size?: 'sm' | 'md'
  className?: string
}

const COLORS = [
  'bg-indigo-500', 'bg-purple-500', 'bg-pink-500', 'bg-rose-500',
  'bg-orange-500', 'bg-amber-500', 'bg-emerald-500', 'bg-teal-500',
  'bg-cyan-500', 'bg-blue-500', 'bg-violet-500', 'bg-fuchsia-500',
]

function colorFromName(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return COLORS[Math.abs(hash) % COLORS.length]
}

export function Avatar({ name, avatarUrl, size = 'sm', className }: AvatarProps) {
  const initials = name ? name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() : '?'
  const color = name ? colorFromName(name) : 'bg-gray-400'
  const sizeClass = size === 'sm' ? 'w-6 h-6 text-xs' : 'w-8 h-8 text-sm'

  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={avatarUrl} alt={name ?? ''} title={name ?? ''}
        className={cn('rounded-full ring-2 ring-white object-cover', sizeClass, className)} />
    )
  }

  return (
    <div title={name ?? ''}
      className={cn('rounded-full ring-2 ring-white flex items-center justify-center text-white font-semibold shrink-0', color, sizeClass, className)}>
      {initials}
    </div>
  )
}

export function AvatarGroup({ users, max = 3 }: { users: { full_name: string | null; avatar_url: string | null }[]; max?: number }) {
  const visible = users.slice(0, max)
  const rest = users.length - max

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
