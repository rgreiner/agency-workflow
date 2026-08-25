'use client'

import { useState, useTransition } from 'react'
import { Clock, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { salvarContextoExtra } from '@/app/actions/rh-ponto'

/** Resultado da batida que fechou o dia com extra pendente e ainda sem contexto. */
export interface ExtraNascida { saldoMin: number }

/** Decide, a partir do retorno de baterPonto, se a pergunta de contexto abre:
 *  a batida FECHOU o período, a extra pende e ninguém contou o porquê ainda. */
export function extraNascida(res?: {
  aberto?: boolean; saldo_min?: number; extra_status?: string | null; tem_contexto?: boolean
} | null): ExtraNascida | null {
  if (res && res.aberto === false && res.extra_status === 'pendente' && !res.tem_contexto) {
    return { saldoMin: res.saldo_min ?? 0 }
  }
  return null
}

/**
 * Pergunta o contexto da hora extra na batida em que ela nasce — a memória está
 * fresca e o gestor decide melhor na aprovação. Só texto livre DE PROPÓSITO
 * (decisão do Rafael, 25/08): o dia pode ter tido N tarefas, e apontar uma só
 * distorceria — quem quiser cita as tarefas no próprio texto. NUNCA trava a
 * saída: "Agora não" fecha e a extra segue pendente do mesmo jeito.
 */
export function ExtraContextoModal({ orgSlug, colaboradorId, extra, onClose }: {
  orgSlug: string; colaboradorId: string; extra: ExtraNascida; onClose: () => void
}) {
  const [motivo, setMotivo] = useState('')
  const [saving, start] = useTransition()

  const saldo = `+${Math.floor(extra.saldoMin / 60)}h${String(extra.saldoMin % 60).padStart(2, '0')}`

  function salvar() {
    if (!motivo.trim()) { toast.error('Conte o motivo da hora extra.'); return }
    // O dia da extra é o de hoje — foi a batida de agora que fechou o período.
    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    start(async () => {
      const r = await salvarContextoExtra(orgSlug, colaboradorId, hoje, motivo.trim())
      if (r?.error) { toast.error(r.error); return }
      toast.success('Anotado — vai junto para a aprovação do gestor.')
      onClose()
    })
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="modal-card w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Clock className="w-4.5 h-4.5 text-orange-600" /> Hora extra registrada
            <span className="text-sm font-semibold text-emerald-600 tabular-nums">{saldo}</span>
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            O dia fechou além da jornada. Conte o que precisou do tempo extra — o gestor vê isso ao decidir.
          </p>
        </div>
        <div className="px-6 py-5">
          <label className="block text-sm text-gray-600 mb-1.5">Motivo</label>
          <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3} autoFocus
            className="w-full px-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
            placeholder="Ex.: finalização da campanha do cliente X e ajustes de última hora no site do Y" />
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">Agora não</button>
          <button onClick={salvar} disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 active:scale-[0.97] disabled:opacity-50 transition-colors">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Salvar
          </button>
        </div>
      </div>
    </div>
  )
}
