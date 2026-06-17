'use client'

import { useOrgSettings } from '@/components/providers/OrgSettingsProvider'
import { getMergedStatusConfig, type StatusConfig } from '@/types'
import { cn } from '@/lib/utils'

/** Config de status já mesclada com as cores definidas em Configurações → Aparência. */
export function useStatusConfig(): StatusConfig[] {
  const { statusOverrides } = useOrgSettings()
  return getMergedStatusConfig(statusOverrides)
}

/**
 * Pill de status padrão — usa SEMPRE as cores da org (hex de `bg`/`text`), pra
 * que o mesmo status tenha a mesma cor em todo o app.
 */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const cfg = useStatusConfig().find(s => s.value === status)
  if (!cfg) return null
  return (
    <span
      className={cn('inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full', className)}
      style={{ backgroundColor: cfg.bg, color: cfg.text }}
    >
      {cfg.label}
    </span>
  )
}
