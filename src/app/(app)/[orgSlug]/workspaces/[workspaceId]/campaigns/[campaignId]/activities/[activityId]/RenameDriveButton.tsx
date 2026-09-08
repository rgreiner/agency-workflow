'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FolderPen, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { renomearPastaDrive } from '@/app/actions/activity'

/**
 * Aparece só quando o nome da pasta diverge do título (a tarefa foi renomeada
 * depois de nascer). Renomeia no lugar, sem criar pasta nova — e só com a pasta
 * vazia; com arquivo dentro o servidor recusa.
 */
export function RenameDriveButton({ orgSlug, path, activityId, atual, esperado }: {
  orgSlug: string; path: string; activityId: string; atual: string; esperado: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  function run() {
    start(async () => {
      const r = await renomearPastaDrive(orgSlug, path, activityId)
      if (r?.error) { toast.error(r.error); return }
      toast.success(`Pasta renomeada para "${r.nome}".`)
      router.refresh()
    })
  }

  return (
    <button onClick={run} disabled={pending}
      title={`A pasta chama "${atual}". Renomear para "${esperado}" — só com a pasta vazia.`}
      className="inline-flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 transition shrink-0 disabled:opacity-50">
      {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <FolderPen className="w-3 h-3" />}
      Renomear pasta
    </button>
  )
}
