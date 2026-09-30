'use client'

import { useEffect, useState, useTransition } from 'react'
import { Sparkles, Loader2, CheckCircle2, PencilLine } from 'lucide-react'
import { toast } from 'sonner'
import { revisarTarefa, mudancasDesdeRevisao } from '@/app/actions/activity'
import { linhaApontamento, type RevisaoEtapa } from '@/lib/ai/revisao-modelos'

interface Apontamento { trecho: string; correcao: string; tipo?: string }

export type ResultadoRevisao =
  | { tipo: 'erros'; errors: Apontamento[] }
  | { tipo: 'limpo' }
  | { tipo: 'aviso'; texto: string }

const MATERIAL: Record<RevisaoEtapa, string> = {
  redacao: 'O texto da Redação', design: 'As peças do Preview', finalizacao: 'O arquivo Final',
}

interface Props {
  activityId: string
  path: string
  etapa: RevisaoEtapa
  /** Rótulo da etapa ("Redação", "Design"…). */
  etapaLabel: string
  /** Última revisão desta etapa (activity_revisao), se ainda vale. */
  ultima: ResultadoRevisao | null
  /**
   * Etapa já PASSADA: o bloco só aparece se o material dela mudou depois da
   * revisão (ex.: texto da Redação editado com a tarefa em Design).
   */
  anterior?: boolean
}

/**
 * Botão "Revisar" — a pessoa revisa ANTES de avançar o status (obrigatório nas
 * etapas ligadas) e vê só os apontamentos: Erro "trecho" - correção. Seguir com
 * apontamento é decisão dela, confirmada ao mover (useAvancoRevisado). Se o
 * material mudou desde a revisão, avisa — e a nova revisão olha só o que mudou.
 */
export function RevisaoIA({ activityId, path, etapa, etapaLabel, ultima, anterior }: Props) {
  const [res, setRes] = useState<ResultadoRevisao | null>(ultima)
  const [mudou, setMudou] = useState(false)
  const [pending, start] = useTransition()

  // Confere no Drive/S3 se o material mudou desde a revisão (sem baixar arquivo).
  useEffect(() => {
    if (!ultima && !anterior) return
    let vivo = true
    mudancasDesdeRevisao(activityId, [etapa]).then(l => { if (vivo) setMudou(l.includes(etapa)) }).catch(() => {})
    return () => { vivo = false }
  }, [activityId, etapa, ultima, anterior])

  function revisar() {
    start(async () => {
      const r = await revisarTarefa(path, activityId, etapa)
      if ('error' in r) { toast.error(r.error); return }
      setMudou(false)
      if (!r.ok) { setRes({ tipo: 'aviso', texto: r.aviso }); return }
      setRes(r.errors.length ? { tipo: 'erros', errors: r.errors } : { tipo: 'limpo' })
      if (r.parcial) toast.message('Revisado só o que mudou desde a última revisão.')
      if (r.truncated) toast.message('O material é longo: só o começo foi revisado.')
    })
  }

  // Etapa passada sem mudança e sem revisão nova nesta visita: nada a mostrar.
  if (anterior && !mudou && !pending && res === ultima) return null

  const cabecalho = pending
    ? `Revisando ${etapaLabel}… pode levar até um minuto.`
    : mudou
      ? `${MATERIAL[etapa]} mudou depois da revisão — revise de novo antes de avançar.`
      : res ? `Revisão de ${etapaLabel}.` : `Revise ${etapaLabel} antes de avançar a tarefa — é obrigatório.`

  return (
    <div className="mt-4 rounded-2xl border border-gray-200 bg-white px-4 py-3">
      <div className="flex items-center gap-3">
        {mudou && !pending
          ? <PencilLine className="w-4 h-4 text-amber-500 shrink-0" />
          : <Sparkles className="w-4 h-4 text-orange-500 shrink-0" />}
        <p className="flex-1 min-w-0 text-sm text-gray-700">{cabecalho}</p>
        <button
          type="button"
          onClick={revisar}
          disabled={pending}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-orange-600 text-[#fff] hover:bg-orange-700 active:scale-[0.97] transition-colors disabled:opacity-50"
        >
          {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {anterior ? `Revisar ${etapaLabel}` : res ? 'Revisar de novo' : 'Revisar'}
        </button>
      </div>

      {!pending && !mudou && res?.tipo === 'erros' && (
        <div className="mt-3 border-t border-gray-100 pt-3 text-sm text-gray-800">
          <p className="font-medium">Revisão solicitada:</p>
          <ul className="mt-1 space-y-1">
            {res.errors.map((e, i) => (
              <li key={i}>{linhaApontamento(e)}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-500">Corrija e revise de novo — ou, ao avançar, confirme que segue com estes apontamentos.</p>
        </div>
      )}
      {!pending && !mudou && res?.tipo === 'limpo' && (
        <p className="mt-3 border-t border-gray-100 pt-3 text-sm text-gray-600 inline-flex items-center gap-1.5 w-full">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Revisão solicitada: nenhum erro encontrado.
        </p>
      )}
      {!pending && !mudou && res?.tipo === 'aviso' && (
        <p className="mt-3 border-t border-gray-100 pt-3 text-sm text-gray-500">{res.texto}</p>
      )}
    </div>
  )
}
