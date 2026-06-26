'use client'

import { useTransition } from 'react'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { confirmReviewErrors } from '@/app/actions/activity'
import { toast } from 'sonner'

interface ReviewError { trecho: string; problema: string; sugestao: string; tipo?: string }

// kind → status do gate (onde a tarefa volta) + textos.
const GATE: Record<string, { status: string; label: string; reviewing: string }> = {
  redacao:     { status: 'redacao',     label: 'Redação',     reviewing: 'os textos de Redação' },
  design:      { status: 'design',      label: 'Design',      reviewing: 'as peças de Design' },
  finalizacao: { status: 'finalizacao', label: 'Finalização', reviewing: 'o arquivo de Finalização' },
}

interface Props {
  activityId: string
  path: string
  /** activities.review_status */
  status: string | null
  /** activities.review_errors */
  errors: ReviewError[] | null
  /** activities.review_kind */
  kind: string | null
  /** activities.status (atual) */
  currentStatus: string
}

export function ReviewBanner({ activityId, path, status, errors, kind, currentStatus }: Props) {
  const [pending, start] = useTransition()
  const gate = (kind && GATE[kind]) || GATE.redacao

  // Revisão em andamento (a tarefa já avançou; a IA está checando em 2º plano).
  if (status === 'reviewing') {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5 text-sm text-orange-700">
        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
        Revisando {gate.reviewing}…
      </div>
    )
  }

  // Revisão não concluída (erro técnico) — avisa sem travar; detalhe no comentário.
  if (status === 'failed') {
    return (
      <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        A revisão automática de {gate.label} não pôde ser concluída — veja o comentário e siga manualmente.
      </div>
    )
  }

  // Apontamentos pendentes só importam enquanto a tarefa está (de volta) no gate.
  if (status !== 'errors' || currentStatus !== gate.status || !errors?.length) return null

  function confirm() {
    start(async () => {
      const r = await confirmReviewErrors(path, activityId)
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
            A revisão de {gate.label} encontrou {errors.length} {errors.length === 1 ? 'apontamento' : 'apontamentos'}
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
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-600 text-[#fff] hover:bg-amber-700 disabled:opacity-50 transition"
          >
            {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Avançar mesmo assim
          </button>
        </div>
      </div>
    </div>
  )
}
