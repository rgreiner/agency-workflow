'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, BellOff, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { setActivityMute } from '@/app/actions/activity'

/**
 * "Silenciar tarefa": para de receber notificação de mudança de status desta
 * tarefa. Comentário e @menção continuam avisando.
 */
export function MuteButton({ orgSlug, path, activityId, muted: initial }: {
  orgSlug: string; path: string; activityId: string; muted: boolean
}) {
  const router = useRouter()
  const [muted, setMuted] = useState(initial)
  const [pending, start] = useTransition()

  function toggle() {
    const next = !muted
    setMuted(next)
    start(async () => {
      const res = await setActivityMute(orgSlug, path, activityId, next)
      if (res?.error) { setMuted(!next); toast.error(res.error); return }
      toast.success(next ? 'Tarefa silenciada — sem avisos de status (comentários ainda avisam).' : 'Notificações reativadas.')
      router.refresh()
    })
  }

  return (
    <button
      onClick={toggle}
      disabled={pending}
      title={muted ? 'Silenciada — clique para reativar os avisos de status' : 'Silenciar avisos de mudança de status (comentários continuam)'}
      className={`inline-flex items-center gap-1.5 text-xs transition disabled:opacity-50 ${muted ? 'text-orange-600 hover:text-orange-700' : 'text-gray-400 hover:text-gray-600'}`}
    >
      {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : muted ? <BellOff className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
      {muted ? 'Silenciada' : 'Silenciar'}
    </button>
  )
}
