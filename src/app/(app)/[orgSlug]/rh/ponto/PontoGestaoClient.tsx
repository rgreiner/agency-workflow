'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Clock, FileText, Check, X, Ban, CalendarX } from 'lucide-react'
import { toast } from 'sonner'
import { decidirExtra, decidirJustificativa } from '@/app/actions/rh-ponto'

interface Colab { nome: string | null }
export interface ExtraPend { id: string; data: string; minutos: number; saldo_min: number; acima_10h: boolean; rh_colaborador: Colab | null }
export interface JustPend { id: string; data_ini: string; data_fim: string; tipo: string; descricao: string | null; status: string; rh_colaborador: Colab | null }

const dataBR = (d: string) => { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}` }
const saldoStr = (m: number) => `+${Math.floor(Math.abs(m) / 60)}h${String(Math.abs(m) % 60).padStart(2, '0')}`
const TIPO: Record<string, string> = { esqueci: 'Esqueceu de bater', atestado: 'Atestado', medico: 'Consulta médica', falta: 'Falta', outro: 'Outro' }

export function PontoGestaoClient({ orgSlug, extras, justificativas }: { orgSlug: string; extras: ExtraPend[]; justificativas: JustPend[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  function extra(id: string, status: string) {
    start(async () => {
      const r = await decidirExtra(orgSlug, id, status)
      if (r?.error) toast.error(r.error); else { toast.success(status === 'aprovado' ? 'Hora extra aprovada.' : 'Hora extra rejeitada.'); router.refresh() }
    })
  }
  function just(id: string, status: string) {
    start(async () => {
      const r = await decidirJustificativa(orgSlug, id, status)
      if (r?.error) toast.error(r.error); else { toast.success('Justificativa decidida.'); router.refresh() }
    })
  }

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-1"><Clock className="w-5 h-5 text-orange-600" /> Ponto — aprovações</h1>
      <p className="text-gray-500 text-sm mb-6">Horas extras (aprova o gestor) e justificativas (decide o RH).</p>

      {/* Horas extras */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Horas extras pendentes <span className="text-gray-400">{extras.length}</span></h2>
        {extras.length === 0 ? (
          <p className="text-sm text-gray-400 py-3">Nada pendente.</p>
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-50">
            {extras.map(e => (
              <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900">{e.rh_colaborador?.nome ?? '—'}</div>
                  <div className="text-xs text-gray-500 tabular-nums">{dataBR(e.data)} · saldo <b className="text-emerald-600">{saldoStr(e.saldo_min)}</b>{e.acima_10h && <span className="text-red-500"> · acima de 10h</span>}</div>
                </div>
                <button onClick={() => extra(e.id, 'aprovado')} disabled={pending}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-[#fff] hover:bg-emerald-700 disabled:opacity-50 transition"><Check className="w-3.5 h-3.5" /> Aprovar</button>
                <button onClick={() => extra(e.id, 'rejeitado')} disabled={pending}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition"><X className="w-3.5 h-3.5" /> Rejeitar</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Justificativas */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5"><FileText className="w-4 h-4" /> Justificativas pendentes <span className="text-gray-400">{justificativas.length}</span></h2>
        {justificativas.length === 0 ? (
          <p className="text-sm text-gray-400 py-3">Nada pendente.</p>
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-50">
            {justificativas.map(j => (
              <div key={j.id} className="px-4 py-3">
                <div className="flex items-start gap-3 mb-2">
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900">{j.rh_colaborador?.nome ?? '—'} <span className="text-[10px] font-medium text-gray-500 bg-gray-100 rounded px-1.5 py-0.5 ml-1">{TIPO[j.tipo] ?? j.tipo}</span></div>
                    <div className="text-xs text-gray-500 tabular-nums">{dataBR(j.data_ini)}{j.data_fim !== j.data_ini && ` – ${dataBR(j.data_fim)}`}{j.descricao && <span className="text-gray-400"> · {j.descricao}</span>}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => just(j.id, 'aprovado')} disabled={pending} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-[#fff] hover:bg-emerald-700 disabled:opacity-50 transition"><Check className="w-3.5 h-3.5" /> Aprovar</button>
                  <button onClick={() => just(j.id, 'abonado')} disabled={pending} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-sky-600 text-[#fff] hover:bg-sky-700 disabled:opacity-50 transition"><Check className="w-3.5 h-3.5" /> Abonar</button>
                  <button onClick={() => just(j.id, 'falta')} disabled={pending} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-600 text-[#fff] hover:bg-amber-700 disabled:opacity-50 transition"><CalendarX className="w-3.5 h-3.5" /> Dar falta</button>
                  <button onClick={() => just(j.id, 'rejeitado')} disabled={pending} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition"><Ban className="w-3.5 h-3.5" /> Rejeitar</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
