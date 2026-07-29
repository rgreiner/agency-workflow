'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Select } from '@/components/ui/Select'
import { BOARD_LEVELS, roleRank } from '@/lib/boards/access'
import type { MemberRole } from '@/types'
import { Lock } from 'lucide-react'
import { toast } from 'sonner'

interface Props {
  boardId: string
  initialMinRole: MemberRole
  viewerRole: MemberRole
}

/**
 * Seletor do nível mínimo de acesso do quadro. As opções vão só até o cargo de
 * quem está vendo (não dá pra travar acima do próprio nível — o RLS também
 * garante isso). Grava direto na tabela; se o banco recusar, reverte.
 */
export function BoardAccessControl({ boardId, initialMinRole, viewerRole }: Props) {
  const supabase = createClient()
  const [minRole, setMinRole] = useState<MemberRole>(initialMinRole)
  const [saving, setSaving] = useState(false)

  const max = roleRank(viewerRole)
  const options = BOARD_LEVELS.filter(l => roleRank(l.value) <= max)

  async function change(value: string) {
    const next = value as MemberRole
    const prev = minRole
    setMinRole(next)
    setSaving(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('visual_boards').update({ min_role: next } as any).eq('id', boardId))
    setSaving(false)
    if (error) {
      setMinRole(prev)
      toast.error('Não foi possível alterar o acesso do quadro.')
    } else {
      toast.success('Acesso do quadro atualizado.')
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="Quem vê e edita este quadro">
      <Lock size={13} color="#6b7280" />
      <Select
        value={minRole}
        onChange={change}
        options={options}
        size="sm"
        align="right"
        className={saving ? 'opacity-70 pointer-events-none' : undefined}
      />
    </div>
  )
}
