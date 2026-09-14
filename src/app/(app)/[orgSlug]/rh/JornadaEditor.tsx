'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Clock, Check, Loader2, RotateCcw, Pencil, CalendarClock, History } from 'lucide-react'
import { toast } from 'sonner'
import { salvarJornada, resetarJornada } from '@/app/actions/rh'

export interface JornadaVals {
  entrada: string; intervalo_ini: string; intervalo_fim: string; saida: string
  flex_min: number; tolerancia_min: number; dias_semana: number[]
}

/** Uma jornada com a data em que passou a valer (mig. 288). */
export interface JornadaVig extends Partial<JornadaVals> {
  vigencia_ini: string
  carga_min?: number | null
}
/** Antes da 288 toda jornada era "desde sempre" — essa data marca isso. */
export const SEM_VIGENCIA = '1900-01-01'

const DIAS: { dow: number; label: string }[] = [
  { dow: 1, label: 'Seg' }, { dow: 2, label: 'Ter' }, { dow: 3, label: 'Qua' },
  { dow: 4, label: 'Qui' }, { dow: 5, label: 'Sex' }, { dow: 6, label: 'Sáb' }, { dow: 7, label: 'Dom' },
]
const PADRAO: JornadaVals = { entrada: '08:30', intervalo_ini: '12:00', intervalo_fim: '13:30', saida: '18:00', flex_min: 30, tolerancia_min: 10, dias_semana: [1, 2, 3, 4, 5] }

const hhmm = (t: string | null | undefined) => (t ?? '').slice(0, 5)
const dataBR = (d: string) => d.split('-').reverse().join('/')
function toMin(t: string): number { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0) }
/** Carga diária derivada (manhã + tarde), em "Xh Ym". */
function cargaLabel(v: JornadaVals): string {
  const min = Math.max(0, (toMin(v.intervalo_ini) - toMin(v.entrada)) + (toMin(v.saida) - toMin(v.intervalo_fim)))
  const h = Math.floor(min / 60), m = min % 60
  return m === 0 ? `${h}h/dia` : `${h}h${String(m).padStart(2, '0')}/dia`
}
/** Janela de entrada permitida pela flexibilidade (ex.: 08:00 – 09:00). */
function janela(v: JornadaVals): string {
  const t = toMin(v.entrada)
  const f = (m: number) => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  return `${f(t - v.flex_min)} – ${f(t + v.flex_min)}`
}

export function normalizar(j: Partial<JornadaVals> | null | undefined): JornadaVals {
  if (!j) return { ...PADRAO }
  return {
    entrada: hhmm(j.entrada) || PADRAO.entrada,
    intervalo_ini: hhmm(j.intervalo_ini) || PADRAO.intervalo_ini,
    intervalo_fim: hhmm(j.intervalo_fim) || PADRAO.intervalo_fim,
    saida: hhmm(j.saida) || PADRAO.saida,
    flex_min: j.flex_min ?? PADRAO.flex_min,
    tolerancia_min: j.tolerancia_min ?? PADRAO.tolerancia_min,
    dias_semana: j.dias_semana?.length ? [...j.dias_semana] : PADRAO.dias_semana,
  }
}

const inputCls = 'w-full px-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500'
const labelCls = 'block text-xs font-medium text-gray-500 mb-1'

/** Editor de jornada. modo 'org' = padrão da empresa (sempre editável).
 *  modo 'pessoa' = ficha: herda o padrão ou personaliza (com "voltar ao padrão"). */
export function JornadaEditor({ orgSlug, colaboradorId, inicial, temOverride = false, padrao, historico = [] }: {
  orgSlug: string
  colaboradorId: string | null
  inicial: Partial<JornadaVals> | null
  temOverride?: boolean
  padrao?: Partial<JornadaVals> | null
  /** Todas as vigências desta pessoa, da mais nova para a mais antiga. */
  historico?: JornadaVig[]
}) {
  const router = useRouter()
  const modoOrg = colaboradorId === null
  const [editando, setEditando] = useState(modoOrg || temOverride)
  const [v, setV] = useState<JornadaVals>(normalizar(inicial))
  const [saving, start] = useTransition()
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  // Qual vigência está sendo escrita. Abre na que vale hoje: salvar sem mexer
  // aqui corrige o horário atual (e recalcula esse trecho). Para mudar só daqui
  // pra frente — horário novo, promoção — basta adiantar a data.
  const vigAtual = (inicial as JornadaVig | null)?.vigencia_ini ?? SEM_VIGENCIA
  const [vig, setVig] = useState(vigAtual)
  const anteriores = historico.filter(h => h.vigencia_ini !== vigAtual)
  const novaVigencia = vig !== vigAtual
  // Mexer na vigência de trás reescreve a carga de um período já vivido.
  const reescreveOPassado = !novaVigencia && vigAtual < hoje && !!colaboradorId
  const set = <K extends keyof JornadaVals>(k: K, val: JornadaVals[K]) => setV(p => ({ ...p, [k]: val }))
  const toggleDia = (dow: number) => setV(p => ({
    ...p, dias_semana: p.dias_semana.includes(dow) ? p.dias_semana.filter(d => d !== dow) : [...p.dias_semana, dow].sort((a, b) => a - b),
  }))

  function salvar() {
    if (!v.dias_semana.length) { toast.error('Selecione ao menos um dia da semana.'); return }
    start(async () => {
      const r = await salvarJornada(orgSlug, colaboradorId, { ...v, vigencia_ini: vig })
      if (r?.error) toast.error(r.error)
      else {
        toast.success(novaVigencia
          ? `Jornada nova vale a partir de ${dataBR(vig)}. O que veio antes fica como estava.`
          : 'Jornada salva.')
        router.refresh()
      }
    })
  }
  function voltarAoPadrao() {
    if (!colaboradorId) return
    start(async () => {
      const r = await resetarJornada(orgSlug, colaboradorId)
      if ('error' in r) { toast.error(r.error); return }
      // Com histórico, sai só a vigência atual — quem volta a valer é a anterior.
      toast.success(r.volta_para
        ? `Jornada de ${dataBR(r.volta_para)} voltou a valer.`
        : 'Jornada voltou ao padrão da empresa.')
      setEditando(false); router.refresh()
    })
  }

  // Modo pessoa herdando o padrão: mostra resumo + botão personalizar.
  if (!modoOrg && !editando) {
    const p = normalizar(padrao)
    return (
      <div className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3">
        <div className="text-sm text-gray-600">
          Usa a <b className="text-gray-800">jornada padrão da empresa</b>
          <span className="text-gray-400"> · {p.entrada}–{p.saida} · {cargaLabel(p)}</span>
        </div>
        <button onClick={() => { setV(normalizar(padrao)); setEditando(true) }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition">
          <Pencil className="w-3.5 h-3.5" /> Personalizar
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div><label className={labelCls}>Entrada</label><input type="time" value={v.entrada} onChange={e => set('entrada', e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Saída p/ almoço</label><input type="time" value={v.intervalo_ini} onChange={e => set('intervalo_ini', e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Volta do almoço</label><input type="time" value={v.intervalo_fim} onChange={e => set('intervalo_fim', e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Saída</label><input type="time" value={v.saida} onChange={e => set('saida', e.target.value)} className={inputCls} /></div>
      </div>

      <div>
        <label className={labelCls}>Dias da semana</label>
        <div className="flex flex-wrap gap-1.5">
          {DIAS.map(d => {
            const on = v.dias_semana.includes(d.dow)
            return (
              <button key={d.dow} type="button" onClick={() => toggleDia(d.dow)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition active:scale-[0.97] ${on ? 'bg-orange-600 text-[#fff]' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                {d.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Flexibilidade de horário (± min)</label>
          <input type="number" min={0} max={120} value={v.flex_min} onChange={e => set('flex_min', Math.max(0, Number(e.target.value) || 0))} className={inputCls} />
          <p className="text-[11px] text-gray-400 mt-1">Janela em que pode entrar: {janela(v)}. Não muda a conta de horas.</p>
        </div>
        <div>
          <label className={labelCls}>Tolerância diária (± min)</label>
          <input type="number" min={0} max={60} value={v.tolerancia_min} onChange={e => set('tolerancia_min', Math.max(0, Number(e.target.value) || 0))} className={inputCls} />
          <p className="text-[11px] text-gray-400 mt-1">Variação no total do dia que não vira extra nem débito. CLT: 10 min.</p>
        </div>
      </div>
      <div className="text-xs text-gray-400 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Carga derivada: <b className="text-gray-600">{cargaLabel(v)}</b></div>

      {/* Desde a mig. 288 a jornada tem data: sem isso, corrigir o horário de
          hoje refazia a conta de meses já fechados. */}
      <div className="rounded-xl bg-gray-50 p-3 space-y-2">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className={labelCls}><CalendarClock className="w-3 h-3 inline mr-1 -mt-0.5" />Vale a partir de</label>
            <input type="date" value={vig === SEM_VIGENCIA ? '' : vig}
              onChange={e => setVig(e.target.value || SEM_VIGENCIA)}
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900" />
          </div>
          <p className="flex-1 min-w-[14rem] text-[11px] text-gray-500 pb-1">
            {novaVigencia
              ? <>Vira uma jornada <b className="text-gray-700">nova</b>: vale de {dataBR(vig)} em diante e não toca no que já passou.</>
              : reescreveOPassado
                ? <>Salvando assim, a jornada em vigor <b className="text-amber-700">desde {vigAtual === SEM_VIGENCIA ? 'sempre' : dataBR(vigAtual)}</b> é
                   corrigida — o cálculo desse período todo é refeito. Para mudar só daqui pra frente, adiante a data.</>
                : <>Em branco = vale para todo o histórico. Informe uma data para a mudança valer só a partir dela.</>}
          </p>
        </div>

        {anteriores.length > 0 && (
          <div className="pt-2 border-t border-gray-200/70">
            <p className="text-[11px] font-medium text-gray-500 flex items-center gap-1 mb-1">
              <History className="w-3 h-3" /> Jornadas anteriores
            </p>
            <ul className="space-y-0.5">
              {anteriores.map(h => (
                <li key={h.vigencia_ini} className="text-[11px] text-gray-500 tabular-nums">
                  {h.vigencia_ini === SEM_VIGENCIA ? 'até então' : `desde ${dataBR(h.vigencia_ini)}`}
                  {' · '}{hhmm(h.entrada)}–{hhmm(h.saida)}
                  {h.carga_min != null && <> · {Math.floor(h.carga_min / 60)}h{h.carga_min % 60 ? String(h.carga_min % 60).padStart(2, '0') : ''}/dia</>}
                </li>
              ))}
            </ul>
            <p className="text-[10.5px] text-gray-400 mt-1">
              Continuam valendo para os dias do período delas — é o que mantém espelho e fechamento fechados.
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-1">
        {!modoOrg && temOverride
          ? <button onClick={voltarAoPadrao} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition disabled:opacity-50"><RotateCcw className="w-3.5 h-3.5" /> Voltar ao padrão da empresa</button>
          : !modoOrg
            ? <button onClick={() => setEditando(false)} disabled={saving} className="px-3 py-2 text-xs text-gray-500 hover:text-gray-700 transition">Cancelar</button>
            : <span />}
        <button onClick={salvar} disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {novaVigencia ? 'Salvar a partir da data' : 'Salvar jornada'}
        </button>
      </div>
    </div>
  )
}
