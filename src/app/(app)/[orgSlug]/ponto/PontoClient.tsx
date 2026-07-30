'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Clock, LogIn, Coffee, Undo2, Loader2, FileText, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Select } from '@/components/ui/Select'
import { baterPonto, criarJustificativa } from '@/app/actions/rh-ponto'

export interface PontoDia {
  data: string; entrada: string | null; intervalo_ini: string | null; intervalo_fim: string | null
  saida: string | null; minutos: number; saldo_min: number; acima_10h: boolean; extra_status: string | null
  // Marcação original, quando o RH ajustou o ponto via justificativa aprovada.
  ajuste_de?: { entrada?: string; intervalo_ini?: string; intervalo_fim?: string; saida?: string } | null
  ajuste_em?: string | null
  // Lista aberta de marcações do dia (N pares) + diagnóstico do almoço.
  marcacoes?: string[]
  intervalo_maior_min?: number | null
  intervalo_ok?: boolean | null
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

  // N marcações livres: ímpar = está trabalhando (próxima é saída/pausa),
  // par = está fora (próxima é entrada/retorno).
  const horas = d?.marcacoes ?? []
  const dentro = horas.length % 2 === 1
  const proxima = horas.length === 0
    ? { label: 'Entrada', icon: LogIn }
    : dentro ? { label: 'Saída (pausa ou fim do dia)', icon: Coffee }
             : { label: 'Retorno', icon: Undo2 }

  function bater() {
    start(async () => {
      const r = await baterPonto(orgSlug, colaboradorId)
      if (r?.error) toast.error(r.error)
      else { toast.success('Ponto registrado!'); router.refresh() }
    })
  }

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
        {horas.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4 mb-2">Nenhuma marcação hoje.</p>
        ) : (
          <div className="flex flex-wrap gap-2 mb-5">
            {horas.map((h, i) => (
              <div key={i} className="rounded-xl border border-orange-200 bg-orange-50/50 px-3 py-2 text-center min-w-[5rem]">
                <div className="text-[11px] text-gray-400">{i === 0 ? 'Entrada' : i % 2 === 1 ? 'Saída' : 'Retorno'}</div>
                <div className="text-base font-semibold tabular-nums text-gray-900">{hm(h)}</div>
              </div>
            ))}
          </div>
        )}

        <button onClick={bater} disabled={pending}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-orange-600 text-[#fff] font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
          {pending ? <Loader2 className="w-5 h-5 animate-spin" /> : <proxima.icon className="w-5 h-5" />} Bater {proxima.label.toLowerCase()}
        </button>
        <p className="text-[11px] text-gray-400 text-center mt-2">
          Pode pausar quantas vezes precisar. Só o almoço (o maior intervalo do dia) precisa ter no mínimo 1h.
        </p>

        {d && !dentro && horas.length > 0 && (
          <div className="text-center pt-3 mt-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">Trabalhado: <b className="tabular-nums">{Math.floor(d.minutos / 60)}h{String(d.minutos % 60).padStart(2, '0')}</b> · saldo <b className={`tabular-nums ${d.saldo_min < 0 ? 'text-red-600' : d.saldo_min > 0 ? 'text-emerald-600' : 'text-gray-500'}`}>{saldoStr(d.saldo_min)}</b>{d.extra_status === 'pendente' && ' · extra aguardando o gestor'}</p>
            {d.intervalo_ok === false && (
              <p className="text-[11px] text-amber-700 mt-1 inline-flex items-center gap-1">
                <Check className="w-3 h-3" /> Almoço de {Math.floor((d.intervalo_maior_min ?? 0) / 60)}h{String((d.intervalo_maior_min ?? 0) % 60).padStart(2, '0')} — abaixo de 1h, o RH vai revisar.
              </p>
            )}
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
                  <td className="px-2 py-2 text-gray-600 tabular-nums">
                    {hm(r.entrada)}–{hm(r.intervalo_ini)} · {hm(r.intervalo_fim)}–{hm(r.saida)}
                    {r.ajuste_em && (
                      <span title={`Ajustado pelo RH. Marcação original: ${[r.ajuste_de?.entrada, r.ajuste_de?.saida].filter(Boolean).map(t => hm(t as string)).join(' – ') || '—'}`}
                        className="ml-1.5 text-[10px] text-amber-600">ajustado</span>
                    )}
                  </td>
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
  const [hEnt, setHEnt] = useState('')
  const [hSai, setHSai] = useState('')
  const [saving, start] = useTransition()

  function enviar() {
    start(async () => {
      const r = await criarJustificativa(orgSlug, colaboradorId, {
        tipo, data_ini: dataIni, data_fim: dataFim, descricao,
        hora_entrada: hEnt || null, hora_saida: hSai || null,
      })
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
          <div className="rounded-xl bg-gray-50 p-3 space-y-2">
            <div className="text-xs font-medium text-gray-600">Horário correto <span className="font-normal text-gray-400">(opcional)</span></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-[11px] text-gray-500 mb-1">Entrada</label><input type="time" value={hEnt} onChange={e => setHEnt(e.target.value)} className={inputCls} /></div>
              <div><label className="block text-[11px] text-gray-500 mb-1">Saída</label><input type="time" value={hSai} onChange={e => setHSai(e.target.value)} className={inputCls} /></div>
            </div>
            <p className="text-[11px] text-gray-400">Preencha se bateu no horário errado (ex.: chegou 8h39 e só bateu 9h37). Ao aprovar, o RH corrige a marcação — a original fica no histórico.</p>
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
