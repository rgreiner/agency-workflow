'use client'

import { CalendarClock, MessageSquareText, Loader2 } from 'lucide-react'
import { formatDateBR } from '@/lib/midia'
import type { EventoHistorico } from '@/app/actions/financeiro'

/**
 * Aba Histórico do lançamento: prorrogações (de → para, com o motivo) e
 * anotações de conversa. Hoje quem escreve aqui são os funcionários digitais
 * (Flávia), e cada linha diz quem fez — "via Flávia" já vem no próprio texto.
 */
export function HistoricoLancamento({ eventos, carregando, erro }: {
  eventos: EventoHistorico[]; carregando: boolean; erro: string
}) {
  if (carregando) {
    return <div className="flex items-center gap-2 px-6 py-10 text-sm text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /> Carregando histórico…</div>
  }
  if (erro) return <p className="mx-6 my-5 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{erro}</p>
  if (!eventos.length) {
    return (
      <div className="px-6 py-10 text-center">
        <p className="text-sm text-gray-500">Nada registrado neste título ainda.</p>
        <p className="text-xs text-gray-400 mt-1">Prorrogações e anotações de conversa (inclusive as da Flávia) aparecem aqui.</p>
      </div>
    )
  }
  return (
    <ol className="px-6 py-5 space-y-3">
      {eventos.map(e => {
        const prorrog = e.tipo === 'prorrogacao'
        const Icone = prorrog ? CalendarClock : MessageSquareText
        const quando = new Date(e.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
        return (
          <li key={e.id} className="flex gap-3 rounded-xl bg-gray-50 px-3.5 py-3">
            <Icone className="w-4 h-4 mt-0.5 shrink-0 text-gray-400" />
            <div className="min-w-0 flex-1">
              {prorrog && (
                <p className="text-sm font-medium text-gray-900">
                  Vencimento {e.de ? formatDateBR(e.de) : '—'} → {e.para ? formatDateBR(e.para) : '—'}
                </p>
              )}
              <p className={prorrog ? 'text-xs text-gray-600 mt-0.5 whitespace-pre-line' : 'text-sm text-gray-800 whitespace-pre-line'}>{e.texto}</p>
              <p className="text-[11px] text-gray-400 mt-1">{e.autor} · {quando}</p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
