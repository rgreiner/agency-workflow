'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, ArchiveRestore, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { setActivityArchived } from '@/app/actions/activity'

/**
 * Faixa no topo da tarefa arquivada, com o Desarquivar ali mesmo. Antes o detalhe
 * não sabia do arquivamento: a tarefa abria como qualquer outra, sem aviso e sem
 * botão, e o único caminho de volta era Lista → Arquivadas (16/09/2026).
 *
 * Acima das abas de propósito: no celular aparece em Tarefa, Comentários e Histórico.
 */
export function AvisoTarefaArquivada({ path, activityId, arquivadaEm, podeDesarquivar }: {
  path: string
  activityId: string
  /** Data já formatada no servidor (evita divergência de fuso na hidratação). */
  arquivadaEm: string | null
  podeDesarquivar: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  function desarquivar() {
    start(async () => {
      const r = await setActivityArchived(path, activityId, false)
      if (r?.error) { toast.error(r.error); return }
      toast.success('Tarefa desarquivada — voltou para a Lista, o Gantt e a busca.')
      router.refresh()
    })
  }

  return (
    <div className="shrink-0 flex items-center gap-2.5 border-b border-amber-200 bg-amber-50 px-4 md:px-6 py-2.5 text-sm text-amber-800">
      <Archive className="w-4 h-4 shrink-0 text-amber-600" />
      <p className="flex-1 min-w-0">
        <span className="font-semibold">Tarefa arquivada{arquivadaEm ? ` em ${arquivadaEm}` : ''}.</span>
        <span className="hidden sm:inline"> Não aparece na Lista, no Gantt nem na busca.</span>
      </p>
      {podeDesarquivar && (
        <button
          type="button"
          onClick={desarquivar}
          disabled={pending}
          className="press shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-medium text-[#fff] hover:bg-orange-700 disabled:opacity-50"
        >
          {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArchiveRestore className="w-3.5 h-3.5" />}
          Desarquivar
        </button>
      )}
    </div>
  )
}
