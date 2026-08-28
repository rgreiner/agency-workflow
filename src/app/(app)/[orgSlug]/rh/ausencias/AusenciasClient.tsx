'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { CalendarRange, ChevronLeft, ChevronRight, Users } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { carregarAusencias, type AusenciaLinha } from '@/app/actions/rh-calendario'

/** Visual por tipo de ausência. A letra é o que se lê na grade densa; o rótulo
 *  completo vai no tooltip e na legenda. */
const TIPO: Record<string, { letra: string; label: string; cls: string }> = {
  feriado:       { letra: '·', label: 'Feriado',        cls: 'bg-gray-200 text-gray-500' },
  ponte:         { letra: 'P', label: 'Recesso/ponte',  cls: 'bg-sky-100 text-sky-700' },
  ferias:        { letra: 'F', label: 'Férias',         cls: 'bg-emerald-100 text-emerald-700' },
  ferias_avulsa: { letra: 'f', label: 'Folga avulsa',   cls: 'bg-emerald-50 text-emerald-600' },
  aviso:         { letra: 'V', label: 'Aviso prévio',   cls: 'bg-amber-100 text-amber-700' },
  atestado:      { letra: 'A', label: 'Atestado',       cls: 'bg-rose-100 text-rose-700' },
  medico:        { letra: 'M', label: 'Consulta médica', cls: 'bg-rose-50 text-rose-600' },
  falta:         { letra: 'X', label: 'Falta',          cls: 'bg-red-200 text-red-800' },
  outro:         { letra: 'o', label: 'Outro',          cls: 'bg-gray-100 text-gray-500' },
}
const visual = (t: string) => TIPO[t] ?? TIPO.outro

const DOW = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const labelMes = (m: string) => { const [y, mm] = m.split('-'); return `${MESES[Number(mm) - 1]} de ${y}` }
const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

/** Dias do mês com metadados de calendário. Date com números locais — nunca
 *  new Date('yyyy-mm-dd'), que é UTC e em BRT cai no dia anterior. */
function diasDoMes(mes: string) {
  const [y, m] = mes.split('-').map(Number)
  const total = new Date(y, m, 0).getDate()
  return Array.from({ length: total }, (_, i) => {
    const dia = i + 1
    const dow = new Date(y, m - 1, dia).getDay()
    return {
      data: `${mes}-${String(dia).padStart(2, '0')}`,
      dia, dow, fds: dow === 0 || dow === 6,
    }
  })
}

export function AusenciasClient({ orgSlug, hoje }: { orgSlug: string; hoje: string }) {
  const [mes, setMes] = useState(hoje.slice(0, 7))
  const [linhas, setLinhas] = useState<AusenciaLinha[] | null>(null)
  const [loading, setLoading] = useState(true)

  const dias = useMemo(() => diasDoMes(mes), [mes])

  const carregar = useCallback(async () => {
    setLoading(true)
    const ini = `${mes}-01`
    const fim = dias[dias.length - 1].data
    const r = await carregarAusencias(orgSlug, ini, fim)
    if (r?.error) { toast.error(r.error); setLinhas(null) } else setLinhas(r?.linhas ?? [])
    setLoading(false)
  }, [orgSlug, mes, dias])

  useEffect(() => { carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  function mudarMes(delta: number) {
    const [y, m] = mes.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setMes(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  // Pessoas (ordem alfabética) e o índice pessoa+dia → ausência.
  const { pessoas, porCelula } = useMemo(() => {
    const map = new Map<string, { id: string; nome: string; cargo: string | null }>()
    const cel = new Map<string, AusenciaLinha>()
    for (const l of linhas ?? []) {
      if (!map.has(l.colaborador_id)) map.set(l.colaborador_id, { id: l.colaborador_id, nome: l.nome, cargo: l.cargo })
      cel.set(`${l.colaborador_id}|${l.data}`, l)
    }
    return {
      pessoas: [...map.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
      porCelula: cel,
    }
  }, [linhas])

  // Quem está fora HOJE (só quando o mês visível é o corrente).
  const foraHoje = useMemo(() => {
    if (hoje.slice(0, 7) !== mes) return []
    return (linhas ?? []).filter(l => l.data === hoje && l.tipo !== 'feriado')
  }, [linhas, hoje, mes])

  // Tipos presentes no mês — a legenda só mostra o que existe.
  const tiposNoMes = useMemo(() => {
    const s = new Set((linhas ?? []).map(l => l.tipo))
    return [...s].sort()
  }, [linhas])

  return (
    <div className="p-6 max-w-full">
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <CalendarRange className="w-5 h-5 text-orange-600" /> Ausências do time
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Quem está fora e quando — férias, recessos, atestados, feriados e aviso prévio numa grade só.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1">
          <button onClick={() => mudarMes(-1)} title="Mês anterior"
            className="p-1.5 rounded-lg text-gray-500 hover:bg-white hover:text-gray-800 transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="px-2 text-sm font-medium text-gray-800 capitalize min-w-[9rem] text-center">{labelMes(mes)}</span>
          <button onClick={() => mudarMes(1)} title="Próximo mês"
            className="p-1.5 rounded-lg text-gray-500 hover:bg-white hover:text-gray-800 transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Fora hoje — a leitura de 1 segundo que a tela precisa dar */}
      {foraHoje.length > 0 && (
        <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 px-4 py-3 mb-4 text-sm text-amber-900 flex items-start gap-2">
          <Users className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <b>Hoje fora:</b>{' '}
            {foraHoje.map(l => `${l.nome.split(' ')[0]} (${visual(l.tipo).label.toLowerCase()}${l.parcial ? ', parcial' : ''})`).join(' · ')}
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Carregando…</div>
      ) : !pessoas.length ? (
        <div className="text-center py-16 text-gray-400 text-sm">Ninguém fora neste mês.</div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white overflow-x-auto">
          <table className="text-sm border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white text-left px-4 py-2.5 text-xs font-medium text-gray-400 border-b border-gray-100 min-w-[13rem]">
                  Colaborador
                </th>
                {dias.map(d => (
                  <th key={d.data}
                    className={cn('px-0 py-1.5 text-[10px] font-medium border-b border-gray-100 w-7',
                      d.data === hoje ? 'text-orange-600' : d.fds ? 'text-gray-300' : 'text-gray-400')}>
                    <div className="leading-none">{DOW[d.dow]}</div>
                    <div className={cn('leading-tight tabular-nums', d.data === hoje && 'font-bold')}>{d.dia}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pessoas.map(p => (
                <tr key={p.id} className="group">
                  <td className="sticky left-0 z-10 bg-white group-hover:bg-orange-50/40 px-4 py-2 border-b border-gray-50 transition-colors">
                    <Link href={`/${orgSlug}/rh/${p.id}`}
                      className="font-medium text-gray-900 hover:text-orange-600 transition-colors truncate block">
                      {p.nome}
                    </Link>
                    {p.cargo && <div className="text-[11px] text-gray-400 truncate">{p.cargo}</div>}
                  </td>
                  {dias.map(d => {
                    const a = porCelula.get(`${p.id}|${d.data}`)
                    const v = a ? visual(a.tipo) : null
                    return (
                      <td key={d.data}
                        className={cn('px-0 py-2 text-center border-b border-gray-50',
                          d.fds && 'bg-gray-50/60',
                          d.data === hoje && 'bg-orange-50/40')}>
                        {a && v && (
                          <span
                            title={`${dataBR(a.data)} · ${v.label}${a.rotulo && a.rotulo !== v.label ? ` — ${a.rotulo}` : ''}${a.parcial ? ' (parte do dia)' : ''}`}
                            className={cn(
                              'inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-semibold',
                              v.cls,
                              // Parcial: mesma cor, contorno tracejado e fundo
                              // mais leve — não é o dia inteiro fora.
                              // (border-dashed, não ring: ring não tem estilo.)
                              a.parcial && 'border border-dashed border-current opacity-70',
                            )}>
                            {v.letra}
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Legenda — só os tipos que aparecem no mês */}
      {tiposNoMes.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3">
          {tiposNoMes.map(t => {
            const v = visual(t)
            return (
              <span key={t} className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
                <span className={cn('inline-flex items-center justify-center w-4 h-4 rounded text-[9px] font-semibold', v.cls)}>{v.letra}</span>
                {v.label}
              </span>
            )
          })}
          <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-400">
            <span className="inline-flex w-4 h-4 rounded border border-dashed border-gray-400 opacity-70" /> parte do dia
          </span>
        </div>
      )}

      <p className="text-[11px] text-gray-400 mt-3">
        Férias e recessos saem de RH → Férias e 13º · atestados e faltas, das justificativas decididas em
        RH → Aprovações · feriados, do Calendário · aviso prévio, da ficha da pessoa. Correção de marcação
        (“esqueci de bater”) não conta como ausência.
      </p>
    </div>
  )
}
