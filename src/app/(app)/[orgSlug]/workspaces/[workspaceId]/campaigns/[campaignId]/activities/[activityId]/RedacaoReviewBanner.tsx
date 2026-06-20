'use client'

import { useTransition } from 'react'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { confirmRedacaoErrors } from '@/app/actions/activity'
import { toast } from 'sonner'

interface ReviewError { trecho: string; problema: string; sugestao: string; tipo?: string }

interface Props {
  activityId: string
  path: string
  /** activities.redacao_review_status */
  status: string | null
  /** activities.redacao_review_errors */
  errors: ReviewError[] | null
  /** activities.status (atual) */
  currentStatus: string
}

export function RedacaoReviewBanner({ activityId, path, status, errors, currentStatus }: Props) {
  const [pending, start] = useTransition()

  // Revisão em andamento (a tarefa já avançou; a IA está checando em 2º plano).
  if (status === 'reviewing') {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm text-indigo-700">
        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
        Revisando os textos de Redação…
      </div>
    )
  }

  // Apontamentos pendentes só importam enquanto a tarefa está (de volta) em Redação.
  if (status !== 'errors' || currentStatus !== 'redacao' || !errors?.length) return null

  function confirm() {
    start(async () => {
      const r = await confirmRedacaoErrors(path, activityId)
      if (r?.error) toast.error(r.error)
      else toast.success('Avançado com os apontamentos assumidos')
    })
  }

  return (
    <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-800">
            A revisão encontrou {errors.length} {errors.length === 1 ? 'apontamento' : 'apontamentos'} de português
          </p>
          <p className="text-xs text-amber-700 mt-0.5">
            Os detalhes estão no comentário abaixo. Corrija e mova de novo, ou avance assumindo os apontamentos.
          </p>
          <ul className="mt-2 space-y-1">
            {errors.slice(0, 4).map((e, i) => (
              <li key={i} className="text-xs text-amber-800">
                <span className="font-medium">“{e.trecho}”</span> → {e.sugestao}
              </li>
            ))}
            {errors.length > 4 && (
              <li className="text-xs text-amber-600">+{errors.length - 4} no comentário</li>
            )}
          </ul>
          <button
            type="button"
            onClick={confirm}
            disabled={pending}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition"
          >
            {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Avançar mesmo assim
          </button>
        </div>
      </div>
    </div>
  )
}
