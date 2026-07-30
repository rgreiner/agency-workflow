'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, Trash2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Select } from '@/components/ui/Select'
import { salvarFeriado, excluirFeriado, type Feriado, type TipoFeriado } from '@/app/actions/rh-calendario'

const TIPOS: { value: TipoFeriado; label: string }[] = [
  { value: 'feriado', label: 'Feriado' },
  { value: 'emenda', label: 'Emenda de feriado' },
  { value: 'facultativo', label: 'Ponto facultativo' },
]
const CLS: Record<string, string> = {
  feriado: 'bg-red-50 text-red-700 ring-red-200',
  emenda: 'bg-amber-50 text-amber-700 ring-amber-200',
  facultativo: 'bg-sky-50 text-sky-700 ring-sky-200',
}
const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const tipoLabel = (t: string) => TIPOS.find(x => x.value === t)?.label ?? t

export function CalendarioClient({ orgSlug, feriados, hoje }: { orgSlug: string; feriados: Feriado[]; hoje: string }) {
  const router = useRouter()
  const [ano, setAno] = useState(Number(hoje.slice(0, 4)))
  const [mes, setMes] = useState(Number(hoje.slice(5, 7)))
  const [sel, setSel] = useState<string | null>(null)
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<TipoFeriado>('feriado')
  const [pending, start] = useTransition()

  const mapa = useMemo(() => new Map(feriados.map(f => [f.data, f])), [feriados])
  const doAno = useMemo(() => feriados.filter(f => f.data.startsWith(String(ano))), [feriados, ano])

  // Grade do mês começando no domingo.
  const grade = useMemo(() => {
    const primeiro = new Date(Date.UTC(ano, mes - 1, 1))
    const offset = primeiro.getUTCDay()                      // dom=0 … sáb=6
    const dias = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
    const cells: (number | null)[] = Array(offset).fill(null)
    for (let d = 1; d <= dias; d++) cells.push(d)
    while (cells.length % 7 !== 0) cells.push(null)
    return cells
  }, [ano, mes])

  function abrir(d: number) {
    const data = iso(ano, mes, d)
    const f = mapa.get(data)
    setSel(data); setNome(f?.nome ?? ''); setTipo((f?.tipo as TipoFeriado) ?? 'feriado')
  }

  function salvar() {
    if (!sel) return
    start(async () => {
      const r = await salvarFeriado(orgSlug, sel, nome, tipo)
      if (r?.error) toast.error(r.error)
      else { toast.success('Dia marcado no calendário.'); setSel(null); router.refresh() }
    })
  }
  function remover(data: string) {
    start(async () => {
      const r = await excluirFeriado(orgSlug, data)
      if (r?.error) toast.error(r.error)
      else { toast.success('Dia desmarcado.'); setSel(null); router.refresh() }
    })
  }

  function navegar(delta: number) {
    let m = mes + delta, y = ano
    if (m < 1) { m = 12; y-- } else if (m > 12) { m = 1; y++ }
    setMes(m); setAno(y)
  }

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-1"><CalendarDays className="w-5 h-5 text-orange-600" /> Calendário</h1>
      <p className="text-gray-500 text-sm mb-6">Feriados, emendas e pontos facultativos. Dia marcado <b>não gera falta</b> no fechamento — e trabalho em feriado conta como hora extra 100%.</p>

      <div className="grid md:grid-cols-[1fr_18rem] gap-5">
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => navegar(-1)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition"><ChevronLeft className="w-4 h-4" /></button>
            <div className="text-sm font-semibold text-gray-900">{MESES[mes - 1]} {ano}</div>
            <button onClick={() => navegar(1)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition"><ChevronRight className="w-4 h-4" /></button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-1">
            {DOW.map(d => <div key={d} className="text-center text-[11px] font-medium text-gray-400 py-1">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {grade.map((d, i) => {
              if (d === null) return <div key={i} />
              const data = iso(ano, mes, d)
              const f = mapa.get(data)
              const fds = (i % 7) === 0 || (i % 7) === 6   // domingo e sábado
              const isHoje = data === hoje
              return (
                <button key={i} onClick={() => abrir(d)}
                  className={`aspect-square rounded-xl text-sm transition active:scale-[0.97] flex flex-col items-center justify-center gap-0.5 ring-1
                    ${f ? `${CLS[f.tipo] ?? CLS.feriado} font-medium` : fds ? 'bg-gray-50 text-gray-400 ring-transparent hover:bg-gray-100' : 'bg-white text-gray-700 ring-gray-100 hover:bg-orange-50'}
                    ${isHoje ? 'ring-2 ring-orange-500' : ''}`}
                  title={f ? `${tipoLabel(f.tipo)}${f.nome ? ` — ${f.nome}` : ''}` : 'Marcar este dia'}>
                  <span>{d}</span>
                  {f && <span className="w-1 h-1 rounded-full bg-current" />}
                </button>
              )
            })}
          </div>

          <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t border-gray-100 text-[11px] text-gray-500">
            {TIPOS.map(t => (
              <span key={t.value} className="inline-flex items-center gap-1.5">
                <span className={`w-3 h-3 rounded ring-1 ${CLS[t.value]}`} /> {t.label}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Marcados em {ano} <span className="font-normal text-gray-400">{doAno.length}</span></h2>
          {doAno.length === 0 ? (
            <p className="text-xs text-gray-400">Nenhum dia marcado. Clique num dia do calendário.</p>
          ) : (
            <ul className="space-y-1.5 max-h-96 overflow-y-auto">
              {doAno.map(f => (
                <li key={f.id} className="flex items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-2">
                  <span className="text-xs tabular-nums text-gray-500 shrink-0">{f.data.slice(8, 10)}/{f.data.slice(5, 7)}</span>
                  <span className="text-xs text-gray-700 truncate flex-1">{f.nome || tipoLabel(f.tipo)}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ring-1 shrink-0 ${CLS[f.tipo] ?? CLS.feriado}`}>{f.tipo === 'feriado' ? '100%' : '50%'}</span>
                  <button onClick={() => remover(f.data)} disabled={pending} title="Desmarcar"
                    className="p-1 text-gray-400 hover:text-red-500 transition disabled:opacity-50 shrink-0"><Trash2 className="w-3 h-3" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {sel && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={e => { if (e.target === e.currentTarget) setSel(null) }}>
          <div className="modal-card w-full max-w-sm bg-white rounded-2xl shadow-xl border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">{sel.slice(8, 10)}/{sel.slice(5, 7)}/{sel.slice(0, 4)}</h2>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Tipo</label>
                <Select value={tipo} onChange={v => setTipo(v as TipoFeriado)} options={TIPOS} />
                <p className="text-[11px] text-gray-400 mt-1.5">
                  {tipo === 'feriado' ? 'Não espera horas; trabalho no dia = extra 100%.' : 'Não espera horas; trabalho no dia = extra 50%.'}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Nome (opcional)</label>
                <input value={nome} onChange={e => setNome(e.target.value)} placeholder="ex.: Corpus Christi"
                  className="w-full px-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>
            </div>
            <div className="flex justify-between gap-2 px-6 py-4 border-t border-gray-100">
              {mapa.has(sel)
                ? <button onClick={() => remover(sel)} disabled={pending} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-500 hover:text-red-600 transition disabled:opacity-50"><Trash2 className="w-3.5 h-3.5" /> Desmarcar</button>
                : <span />}
              <div className="flex gap-2">
                <button onClick={() => setSel(null)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
                <button onClick={salvar} disabled={pending}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
                  {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
