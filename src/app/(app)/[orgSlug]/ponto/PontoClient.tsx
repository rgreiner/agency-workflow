'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Clock, LogIn, Coffee, Undo2, LogOut, Loader2, FileText, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Select } from '@/components/ui/Select'
import { baterPonto, criarJustificativa } from '@/app/actions/rh-ponto'

export interface PontoDia {
  data: string; entrada: string | null; intervalo_ini: string | null; intervalo_fim: string | null
  saida: string | null; minutos: number; saldo_min: number; acima_10h: boolean; extra_status: string | null
}

const hm = (t: string | null) => t ? t.slice(0, 5) : '—'
const saldoStr = (m: number) => { const s = m < 0 ? '-' : '+'; const a = Math.abs(m); return `${s}${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}` }
const dataBR = (d: string) => { const [y, m, dd] = d.split('-'); return `${dd}/${m}` }

export function PontoClient({ orgSlug, colaboradorId, nome, diaHoje, recentes }: {
  orgSlug: string; colaboradorId: string; nome: string; hoje: string; diaHoje: PontoDia | null; recentes: PontoDia[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [just, setJust] = useState(false)
  const d = diaHoje

  const proxima: { tipo: string; label: string; icon: typeof LogIn } | null =
    !d?.entrada ? { tipo: 'entrada', label: 'Entrada', icon: LogIn }
    : !d?.intervalo_ini ? { tipo: 'intervalo_ini', label: 'Início do intervalo', icon: Coffee }
    : !d?.intervalo_fim ? { tipo: 'intervalo_fim', label: 'Retorno do intervalo', icon: Undo2 }
    : !d?.saida ? { tipo: 'saida', label: 'Saída', icon: LogOut }
    : null

  function bater(tipo: string) {
    start(async () => {
      const r = await baterPonto(orgSlug, colaboradorId, tipo)
      if (r?.error) toast.error(r.error)
      else { toast.success('Ponto registrado!'); router.refresh() }
    })
  }

  const marcacoes = [
    { label: 'Entrada', v: d?.entrada, icon: LogIn },
    { label: 'Intervalo', v: d?.intervalo_ini, icon: Coffee },
    { label: 'Retorno', v: d?.intervalo_fim, icon: Undo2 },
    { label: 'Saída', v: d?.saida, icon: LogOut },
  ]

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><Clock className="w-5 h-5 text-orange-600" /> Meu ponto</h1>
          <p className="text-gray-500 text-sm mt-0.5">{nome} · jornada 8h30–12h · 13h30–18h (mín. 1h de intervalo)</p>
        </div>
        <button onClick={() => setJust(true)} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition">
          <FileText className="w-4 h-4" /> Justificar
        </button>
      </div>

      {/* Marcações de hoje */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6">
        <div className="grid grid-cols-4 gap-3 mb-5">
          {marcacoes.map(m => (
            <div key={m.label} className={`rounded-xl border p-3 text-center ${m.v ? 'border-orange-200 bg-orange-50/50' : 'border-gray-100 bg-gray-50'}`}>
              <m.icon className={`w-4 h-4 mx-auto mb-1 ${m.v ? 'text-orange-600' : 'text-gray-300'}`} />
              <div className="text-[11px] text-gray-400">{m.label}</div>
              <div className={`text-base font-semibold tabular-nums ${m.v ? 'text-gray-900' : 'text-gray-300'}`}>{hm(m.v ?? null)}</div>
            </div>
          ))}
        </div>

        {proxima ? (
          <button onClick={() => bater(proxima.tipo)} disabled={pending}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-orange-600 text-[#fff] font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            {pending ? <Loader2 className="w-5 h-5 animate-spin" /> : <proxima.icon className="w-5 h-5" />} Bater {proxima.label.toLowerCase()}
          </button>
        ) : (
          <div className="text-center py-2">
            <p className="text-sm text-emerald-700 font-medium inline-flex items-center gap-1.5"><Check className="w-4 h-4" /> Jornada de hoje concluída</p>
            {d && <p className="text-xs text-gray-500 mt-1">Trabalhado: <b className="tabular-nums">{Math.floor(d.minutos / 60)}h{String(d.minutos % 60).padStart(2, '0')}</b> · saldo <b className={`tabular-nums ${d.saldo_min < 0 ? 'text-red-600' : d.saldo_min > 0 ? 'text-emerald-600' : 'text-gray-500'}`}>{saldoStr(d.saldo_min)}</b>{d.extra_status === 'pendente' && ' · extra aguardando o gestor'}</p>}
          </div>
        )}
      </div>

      {/* Últimos dias */}
      {recentes.length > 0 && (
        <div className="mt-5 rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-4 py-2.5 text-xs font-medium text-gray-400 border-b border-gray-100">Últimos dias</div>
          <table className="w-full text-sm">
            <tbody>
              {recentes.map(r => (
                <tr key={r.data} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-2 text-gray-500 tabular-nums">{dataBR(r.data)}</td>
                  <td className="px-2 py-2 text-gray-600 tabular-nums">{hm(r.entrada)}–{hm(r.intervalo_ini)} · {hm(r.intervalo_fim)}–{hm(r.saida)}</td>
                  <td className="px-2 py-2 text-right text-gray-500 tabular-nums">{Math.floor(r.minutos / 60)}h{String(r.minutos % 60).padStart(2, '0')}</td>
                  <td className={`px-4 py-2 text-right tabular-nums font-medium ${r.saldo_min < 0 ? 'text-red-600' : r.saldo_min > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>{saldoStr(r.saldo_min)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {just && <JustificarModal orgSlug={orgSlug} colaboradorId={colaboradorId} onClose={() => setJust(false)} />}
    </div>
  )
}

function JustificarModal({ orgSlug, colaboradorId, onClose }: { orgSlug: string; colaboradorId: string; onClose: () => void }) {
  const router = useRouter()
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const [tipo, setTipo] = useState('esqueci')
  const [dataIni, setDataIni] = useState(hoje)
  const [dataFim, setDataFim] = useState(hoje)
  const [descricao, setDescricao] = useState('')
  const [saving, start] = useTransition()

  function enviar() {
    start(async () => {
      const r = await criarJustificativa(orgSlug, colaboradorId, { tipo, data_ini: dataIni, data_fim: dataFim, descricao })
      if (r?.error) toast.error(r.error)
      else { toast.success('Justificativa enviada ao RH.'); onClose(); router.refresh() }
    })
  }

  const inputCls = 'w-full px-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500'

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="modal-card w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100"><h2 className="text-base font-semibold text-gray-900">Justificar ocorrência</h2>
          <p className="text-xs text-gray-500 mt-0.5">Vai para o RH decidir (aprovar, abonar ou dar falta).</p></div>
        <div className="px-6 py-5 space-y-3">
          <div><label className="block text-sm text-gray-600 mb-1.5">Tipo</label>
            <Select value={tipo} onChange={setTipo} options={[
              { value: 'esqueci', label: 'Esqueci de bater' }, { value: 'atestado', label: 'Atestado médico' },
              { value: 'medico', label: 'Consulta médica' }, { value: 'falta', label: 'Falta' }, { value: 'outro', label: 'Outro' },
            ]} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1.5">De</label><input type="date" value={dataIni} onChange={e => setDataIni(e.target.value)} className={inputCls} /></div>
            <div><label className="block text-sm text-gray-600 mb-1.5">Até</label><input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)} className={inputCls} /></div>
          </div>
          <div><label className="block text-sm text-gray-600 mb-1.5">Descrição</label><textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={2} className={inputCls} placeholder="Opcional" /></div>
          <p className="text-[11px] text-gray-400">Atestado: envie o PDF depois na sua ficha (o RH anexa à justificativa).</p>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
          <button onClick={enviar} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} Enviar
          </button>
        </div>
      </div>
    </div>
  )
}
