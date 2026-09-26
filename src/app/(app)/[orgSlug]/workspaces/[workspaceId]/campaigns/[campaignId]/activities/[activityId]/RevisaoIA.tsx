'use client'

import { useState, useTransition } from 'react'
import { Sparkles, Loader2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { revisarTarefa } from '@/app/actions/activity'

interface Apontamento { trecho: string; correcao: string }

type Resultado =
  | { tipo: 'erros'; errors: Apontamento[] }
  | { tipo: 'limpo' }
  | { tipo: 'aviso'; texto: string }

interface Props {
  activityId: string
  path: string
  /** Rótulo da etapa atual ("Redação", "Design"…). */
  etapaLabel: string
  /** Última revisão gravada nesta etapa (activities.review_*), se houver. */
  ultima: Resultado | null
}

/**
 * Botão "Revisar" — a pessoa pede a revisão ANTES de mover o status e vê só os
 * apontamentos, no formato: Erro "trecho" - correção. Nada trava: corrigir ou
 * seguir é decisão dela.
 */
export function RevisaoIA({ activityId, path, etapaLabel, ultima }: Props) {
  const [res, setRes] = useState<Resultado | null>(ultima)
  const [pending, start] = useTransition()

  function revisar() {
    start(async () => {
      const r = await revisarTarefa(path, activityId)
      if ('error' in r) { toast.error(r.error); return }
      if (!r.ok) { setRes({ tipo: 'aviso', texto: r.aviso }); return }
      setRes(r.errors.length ? { tipo: 'erros', errors: r.errors } : { tipo: 'limpo' })
      if (r.truncated) toast.message('O material é longo: só o começo foi revisado.')
    })
  }

  return (
    <div className="mt-4 rounded-2xl border border-gray-200 bg-white px-4 py-3">
      <div className="flex items-center gap-3">
        <Sparkles className="w-4 h-4 text-orange-500 shrink-0" />
        <p className="flex-1 min-w-0 text-sm text-gray-700">
          {pending ? `Revisando ${etapaLabel}… pode levar até um minuto.` : `Revise ${etapaLabel} antes de mover a tarefa.`}
        </p>
        <button
          type="button"
          onClick={revisar}
          disabled={pending}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-orange-600 text-[#fff] hover:bg-orange-700 active:scale-[0.97] transition-colors disabled:opacity-50"
        >
          {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {res ? 'Revisar de novo' : 'Revisar'}
        </button>
      </div>

      {!pending && res?.tipo === 'erros' && (
        <div className="mt-3 border-t border-gray-100 pt-3 text-sm text-gray-800">
          <p className="font-medium">Revisão solicitada:</p>
          <ul className="mt-1 space-y-1">
            {res.errors.map((e, i) => (
              <li key={i}>Erro &quot;{e.trecho}&quot; - {e.correcao}</li>
            ))}
          </ul>
        </div>
      )}
      {!pending && res?.tipo === 'limpo' && (
        <p className="mt-3 border-t border-gray-100 pt-3 text-sm text-gray-600 inline-flex items-center gap-1.5 w-full">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Revisão solicitada: nenhum erro encontrado.
        </p>
      )}
      {!pending && res?.tipo === 'aviso' && (
        <p className="mt-3 border-t border-gray-100 pt-3 text-sm text-gray-500">{res.texto}</p>
      )}
    </div>
  )
}
