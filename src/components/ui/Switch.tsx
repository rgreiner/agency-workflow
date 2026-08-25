'use client'

import { cn } from '@/lib/utils'

/**
 * Switch canônico do app (extraído do ProfileForm — o resumo diário já usava
 * este visual; havia várias cópias inline, novas telas devem usar este).
 * `size="sm"` para grades densas.
 */
export function Switch({
  checked, onChange, disabled = false, label, size = 'md',
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  /** aria-label — obrigatório porque o switch não tem texto próprio. */
  label: string
  size?: 'sm' | 'md'
}) {
  const dims = size === 'sm'
    ? { track: 'w-9 h-5', knob: 'w-4 h-4', on: 'translate-x-4' }
    : { track: 'w-11 h-6', knob: 'w-5 h-5', on: 'translate-x-5' }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative shrink-0 rounded-full transition-colors ring-1 ring-inset',
        dims.track,
        checked ? 'bg-orange-600 ring-transparent' : 'bg-gray-300 ring-gray-400/30',
        disabled && 'opacity-40 cursor-not-allowed',
      )}
    >
      <span className={cn(
        'absolute left-0.5 top-0.5 rounded-full bg-[#fff] shadow transition-transform',
        dims.knob,
        checked ? dims.on : 'translate-x-0',
      )} />
    </button>
  )
}
