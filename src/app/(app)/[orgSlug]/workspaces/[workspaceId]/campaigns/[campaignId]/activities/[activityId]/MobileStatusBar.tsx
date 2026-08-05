'use client'

import { useState, useTransition } from 'react'
import { useStatusConfig } from '@/components/ui/StatusBadge'
import { updateActivityStatus } from '@/app/actions/activity'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface Props {
  activityId: string
  currentStatus: string
  path: string
  /** Mesma régua do StatusChanger: cargo cobre o status ATUAL → pode mover. */
  meusStatus?: string[]
  ignoraCargo?: boolean
}

/**
 * Barra fixa no rodapé do detalhe da tarefa — só no celular (fase 3 do PWA).
 * O caso de uso é "passar pra frente / voltar" com o dedão: um toque move na
 * ordem dos status da org. A trava do cargo é antecipação de UX; quem decide
 * de verdade é o servidor (update_activity_status). Renderizar com
 * key={status} — mudança vinda de fora (AutoRefresh) zera o otimismo local.
 */
export function MobileStatusBar({ activityId, currentStatus, path, meusStatus = [], ignoraCargo = false }: Props) {
  const [status, setStatus] = useState(currentStatus)
  const [pending, start] = useTransition()
  const statusConfig = useStatusConfig()

  const cfg = statusConfig.find(s => s.value === status)
  const idx = statusConfig.findIndex(s => s.value === status)
  const anterior = idx > 0 ? statusConfig[idx - 1] : null
  const proximo = idx >= 0 && idx < statusConfig.length - 1 ? statusConfig[idx + 1] : null
  const podeMover = ignoraCargo || meusStatus.length === 0 || meusStatus.includes(status)

  if (!cfg) return null

  function aplicar(novo: string) {
    const antes = status
    setStatus(novo) // otimista
    start(async () => {
      const r = await updateActivityStatus(path, activityId, novo, '')
      if (r?.error) { setStatus(antes); toast.error(r.error); return }
      toast.success(`Status: ${statusConfig.find(s => s.value === novo)?.label}`)
    })
  }

  return (
    <div
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur px-3 pt-2"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' }}
    >
      <div className="flex items-center gap-2">
        {/* Voltar uma etapa */}
        <button
          type="button"
          disabled={!anterior || !podeMover || pending}
          onClick={() => anterior && aplicar(anterior.value)}
          aria-label={anterior ? `Voltar para ${anterior.label}` : 'Sem etapa anterior'}
          className="flex items-center justify-center h-11 w-11 shrink-0 rounded-xl bg-gray-100 text-gray-700 active:scale-[0.97] transition-colors disabled:opacity-40"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        {/* Status atual */}
        <div
          className="flex-1 min-w-0 h-11 rounded-xl flex items-center justify-center gap-1.5 text-sm font-semibold"
          style={{ backgroundColor: cfg.bg, color: cfg.text }}
        >
          {pending && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
          <span className="truncate px-1">{cfg.label}</span>
        </div>

        {/* Avançar — mostra o destino, que é a pergunta que a pessoa tem */}
        <button
          type="button"
          disabled={!proximo || !podeMover || pending}
          onClick={() => proximo && aplicar(proximo.value)}
          aria-label={proximo ? `Avançar para ${proximo.label}` : 'Última etapa'}
          className="flex-1 min-w-0 h-11 flex items-center justify-center gap-1 rounded-xl bg-orange-600 text-[#fff] text-sm font-medium hover:bg-orange-700 active:scale-[0.97] transition-colors disabled:opacity-40"
        >
          <span className="truncate">{proximo ? proximo.label : 'Concluída'}</span>
          {proximo && <ChevronRight className="w-4 h-4 shrink-0" />}
        </button>
      </div>
      {!podeMover && (
        <p className="text-[11px] text-gray-400 text-center mt-1.5">
          Seu cargo não cobre esta etapa — quem cuida dela é que move.
        </p>
      )}
    </div>
  )
}
