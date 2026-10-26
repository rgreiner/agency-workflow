'use client'

import { useState, useTransition } from 'react'
import { Sparkles, Loader2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { revisarTudo } from '@/app/actions/activity'
import { linhaApontamento, type RevisaoEtapa } from '@/lib/ai/revisao-modelos'
import type { ResultadoRevisao } from './RevisaoIA'

const PARTES: { etapa: RevisaoEtapa; label: string }[] = [
  { etapa: 'redacao', label: 'Redação' },
  { etapa: 'design', label: 'Preview' },
  { etapa: 'finalizacao', label: 'Final' },
]

interface Props {
  activityId: string
  path: string
  /** Resultado de cada parte, se já revisada nesta passagem pela Validação. */
  ultima: Partial<Record<RevisaoEtapa, ResultadoRevisao>>
}

/**
 * "Revisar tudo" da Validação de Criação (26/10/2026: a Revisão Interna saiu e a
 * revisão é 100% IA). Roda Redação, Preview e Final de uma vez; para avançar, as
 * três precisam estar revisadas nesta passagem — apontamentos pedem confirmação.
 */
export function RevisaoCompleta({ activityId, path, ultima }: Props) {
  const [res, setRes] = useState(ultima)
  const [pending, start] = useTransition()
  const feitas = PARTES.filter(p => res[p.etapa]).length

  function revisar() {
    start(async () => {
      const r = await revisarTudo(path, activityId)
      if ('error' in r) { toast.error(r.error); return }
      const novo: Partial<Record<RevisaoEtapa, ResultadoRevisao>> = {}
      for (const { etapa, label } of PARTES) {
        const x = r.resultados[etapa]
        if ('error' in x) { novo[etapa] = { tipo: 'aviso', texto: x.error }; toast.error(`${label}: ${x.error}`); continue }
        novo[etapa] = !x.ok ? { tipo: 'aviso', texto: x.aviso } : x.errors.length ? { tipo: 'erros', errors: x.errors } : { tipo: 'limpo' }
      }
      setRes(novo)
    })
  }

  return (
    <div className="mt-4 rounded-2xl border border-gray-200 bg-white px-4 py-3">
      <div className="flex items-center gap-3">
        <Sparkles className="w-4 h-4 text-orange-500 shrink-0" />
        <p className="flex-1 min-w-0 text-sm text-gray-700">
          {pending
            ? 'Revisando Redação, Preview e Final… pode levar de 1 a 3 minutos.'
            : feitas === PARTES.length
              ? 'Revisão completa.'
              : 'Revise tudo (Redação, Preview e Final) antes de avançar — é obrigatório.'}
        </p>
        <button
          type="button"
          onClick={revisar}
          disabled={pending}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-orange-600 text-[#fff] hover:bg-orange-700 active:scale-[0.97] transition-colors disabled:opacity-50"
        >
          {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {feitas ? 'Revisar tudo de novo' : 'Revisar tudo'}
        </button>
      </div>

      {!pending && feitas > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-3 space-y-3 text-sm">
          {PARTES.map(({ etapa, label }) => {
            const r = res[etapa]
            return (
              <div key={etapa}>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
                {!r && <p className="mt-1 text-gray-400">Ainda não revisado.</p>}
                {r?.tipo === 'limpo' && (
                  <p className="mt-1 text-gray-600 inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Nenhum erro encontrado.
                  </p>
                )}
                {r?.tipo === 'aviso' && <p className="mt-1 text-gray-500">{r.texto}</p>}
                {r?.tipo === 'erros' && (
                  <ul className="mt-1 space-y-1 text-gray-800">
                    {r.errors.map((e, i) => <li key={i}>{linhaApontamento(e)}</li>)}
                  </ul>
                )}
              </div>
            )
          })}
          <p className="text-xs text-gray-500">Corrija e revise de novo — ou, ao avançar, confirme que segue com estes apontamentos.</p>
        </div>
      )}
    </div>
  )
}
