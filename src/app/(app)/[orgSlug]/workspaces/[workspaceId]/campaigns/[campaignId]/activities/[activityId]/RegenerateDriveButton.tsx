'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FolderSync, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { regenerarPastaDrive } from '@/app/actions/activity'

/** Cria/re-vincula a pasta do Drive da tarefa (nova pasta, nome com a data). */
export function RegenerateDriveButton({ orgSlug, path, activityId, hasFolder }: {
  orgSlug: string; path: string; activityId: string; hasFolder: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [confirm, setConfirm] = useState(false)

  function run() {
    start(async () => {
      const res = await regenerarPastaDrive(orgSlug, path, activityId)
      if (res?.error) { toast.error(res.error); return }
      toast.success('Pasta do Drive criada e vinculada.')
      setConfirm(false)
      router.refresh()
    })
  }

  // Com pasta já vinculada, pede confirmação (re-vincular troca a pasta atual).
  if (hasFolder && confirm) {
    return (
      <span className="inline-flex items-center gap-2 text-xs shrink-0">
        <span className="text-gray-500">Criar nova pasta?</span>
        <button onClick={run} disabled={pending} className="font-medium text-orange-600 hover:text-orange-700 inline-flex items-center gap-1 disabled:opacity-50">
          {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Sim'}
        </button>
        <button onClick={() => setConfirm(false)} className="text-gray-400 hover:text-gray-600">Não</button>
      </span>
    )
  }

  return (
    <button
      onClick={() => (hasFolder ? setConfirm(true) : run())}
      disabled={pending}
      title={hasFolder ? 'Re-vincular: cria uma pasta nova com o nome+data e troca o vínculo' : 'Criar e vincular a pasta desta tarefa no Drive'}
      className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-orange-600 transition shrink-0 disabled:opacity-50"
    >
      {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <FolderSync className="w-3 h-3" />}
      {hasFolder ? 'Re-vincular' : 'Gerar pasta'}
    </button>
  )
}
