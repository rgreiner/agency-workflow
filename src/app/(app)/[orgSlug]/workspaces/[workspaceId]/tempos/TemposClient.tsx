'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown, ChevronRight, GanttChart, Repeat2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStatusConfig } from '@/components/ui/StatusBadge'
import { fmtDuracao, totaisPorStatus, type Segmento } from '@/lib/status-tempos'
import { Select } from '@/components/ui/Select'

export interface TarefaTempos {
  id: string
  titulo: string
  campanhaId: string
  campanha: string
  statusAtual: string
  arquivada: boolean
  criada: string
  segmentos: Segmento[]
}

const PERIODOS = [
  { value: '30', label: 'Últimos 30 dias' },
  { value: '90', label: 'Últimos 90 dias' },
  { value: '180', label: 'Últimos 180 dias' },
  { value: 'tudo', label: 'Tudo' },
]

const dataBR = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
const dataHoraBR = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/**
 * "Gantt de status" do cliente: cada tarefa é uma barra segmentada pelo tempo em
 * cada etapa (cores do cadastro de status da org). Ida e volta aparece como o
 * mesmo status repetido; a linha expandida soma os totais por etapa.
 * Tempo CORRIDO (lead time do processo) — horas trabalhadas ficam em RH → Horas.
 */
export function TemposClient({ orgSlug, workspaceId, clienteNome, campanhas, campanhaInicial = '', tarefas, agora }: {
  orgSlug: string
  workspaceId: string
  clienteNome: string
  campanhas: { id: string; name: string }[]
  /** Entrando pela campanha, o filtro já vem aplicado nela. */
  campanhaInicial?: string
  tarefas: TarefaTempos[]
  agora: string
}) {
  const pathname = usePathname()
  const statusCfg = useStatusConfig()
  const [periodo, setPeriodo] = useState('30')
  const [campanha, setCampanha] = useState(campanhaInicial)
  const [aberta, setAberta] = useState<string | null>(null)

  const corDe = useMemo(() => {
    const m = new Map<string, { bg: string; text: string; label: string }>()
    for (const s of statusCfg) m.set(s.value as string, { bg: s.bg, text: s.text, label: s.label })
    return m
  }, [statusCfg])
  const cor = (status: string) => corDe.get(status) ?? { bg: '#e5e7eb', text: '#374151', label: status }

  // Eixo: da janela escolhida até agora. Segmentos são recortados ao eixo
  // (a barra de uma tarefa antiga entra "cortada", com indicador de que começou antes).
  const fimEixo = new Date(agora).getTime()
  const iniEixo = useMemo(() => {
    if (periodo !== 'tudo') return fimEixo - Number(periodo) * 86_400_000
    const min = Math.min(...tarefas.map(t => new Date(t.criada).getTime()))
    return Number.isFinite(min) ? min : fimEixo - 90 * 86_400_000
  }, [periodo, tarefas, fimEixo])
  const rangeMs = Math.max(1, fimEixo - iniEixo)

  const visiveis = useMemo(() => {
    return tarefas.filter(t => {
      if (campanha && t.campanhaId !== campanha) return false
      // aparece se teve QUALQUER atividade dentro da janela
      const fimT = Math.max(...t.segmentos.map(s => new Date(s.fim).getTime()))
      return fimT >= iniEixo
    })
  }, [tarefas, campanha, iniEixo])

  // agrupa por campanha, preservando a ordem (mais recente primeiro dentro do grupo)
  const grupos = useMemo(() => {
    const m = new Map<string, TarefaTempos[]>()
    for (const t of visiveis) {
      const arr = m.get(t.campanha) ?? []
      arr.push(t)
      m.set(t.campanha, arr)
    }
    return [...m.entries()]
  }, [visiveis])

  // marcas do eixo: DIA a dia no recorte curto (~mês); semana no médio; mês no longo
  const { marcas, fds } = useMemo(() => {
    const marcas: { pos: number; label: string }[] = []
    const fds: { pos: number; w: number }[] = []
    const dias = rangeMs / 86_400_000
    const passo = dias <= 45 ? 'dia' : dias <= 120 ? 'semana' : 'mes'
    const d = new Date(iniEixo)
    d.setHours(0, 0, 0, 0)
    if (passo === 'mes') { d.setDate(1); d.setMonth(d.getMonth() + 1) }
    else if (passo === 'semana') { const dow = d.getDay(); d.setDate(d.getDate() + ((8 - dow) % 7 || 7)) }
    else d.setDate(d.getDate() + 1)
    let primeira = true
    while (d.getTime() < fimEixo) {
      const pos = ((d.getTime() - iniEixo) / rangeMs) * 100
      if (passo === 'dia') {
        // dia do mês; vira "dd/mm" na primeira marca e a cada virada de mês
        marcas.push({
          pos,
          label: primeira || d.getDate() === 1
            ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
            : String(d.getDate()).padStart(2, '0'),
        })
        // sombra do fim de semana (sáb/dom) p/ leitura diária
        if (d.getDay() === 6 || d.getDay() === 0) fds.push({ pos, w: (86_400_000 / rangeMs) * 100 })
        d.setDate(d.getDate() + 1)
      } else if (passo === 'semana') {
        marcas.push({ pos, label: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) })
        d.setDate(d.getDate() + 7)
      } else {
        marcas.push({ pos, label: d.toLocaleDateString('pt-BR', { month: 'short' }) })
        d.setMonth(d.getMonth() + 1)
      }
      primeira = false
    }
    return { marcas, fds }
  }, [iniEixo, fimEixo, rangeMs])

  // legenda: só status que aparecem nas tarefas visíveis, na ordem do fluxo
  const legenda = useMemo(() => {
    const usados = new Set(visiveis.flatMap(t => t.segmentos.map(s => s.status)))
    return statusCfg.filter(s => usados.has(s.value as string))
  }, [visiveis, statusCfg])

  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-1 text-xs text-gray-400">
        <Link href={`/${orgSlug}/workspaces`} className="hover:text-gray-600 transition-colors">Clientes</Link>
        {' / '}
        <Link href={`/${orgSlug}/workspaces/${workspaceId}`} className="hover:text-gray-600 transition-colors">{clienteNome}</Link>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <GanttChart className="w-5 h-5 text-orange-600" /> Tempos por etapa
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Quanto tempo cada trabalho ficou em cada status — idas e voltas incluídas. Tempo corrido do processo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select size="sm" value={campanha} onChange={setCampanha}
            options={[{ value: '', label: 'Todas as campanhas' }, ...campanhas.map(c => ({ value: c.id, label: c.name }))]} />
          <Select size="sm" value={periodo} onChange={setPeriodo} options={PERIODOS} />
        </div>
      </div>

      {/* Legenda */}
      {legenda.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1.5 mb-4">
          {legenda.map(s => (
            <span key={s.value} className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
              <span className="w-2.5 h-2.5 rounded-[4px]" style={{ backgroundColor: s.bg, boxShadow: `inset 0 0 0 1px ${s.text}22` }} />
              {s.label}
            </span>
          ))}
        </div>
      )}

      {visiveis.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
          Nenhuma tarefa com atividade neste período.
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          {/* régua do eixo */}
          <div className="relative h-7 border-b border-gray-100 ml-[280px] mr-[86px] hidden md:block">
            {fds.map((f, i) => (
              <span key={`f${i}`} className="absolute top-0 h-full bg-gray-100/60" style={{ left: `${f.pos}%`, width: `${f.w}%` }} />
            ))}
            {marcas.map((m, i) => (
              <span key={i} className="absolute top-0 h-full flex items-center text-[9.5px] text-gray-400 border-l border-gray-100 pl-0.5 whitespace-nowrap"
                style={{ left: `${m.pos}%` }}>
                {m.label}
              </span>
            ))}
          </div>

          {grupos.map(([nomeCampanha, ts]) => (
            <div key={nomeCampanha}>
              <div className="px-4 py-1.5 bg-gray-50/70 border-y border-gray-100 first:border-t-0 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                {nomeCampanha} <span className="text-gray-300 normal-case tracking-normal">· {ts.length}</span>
              </div>
              {ts.map(t => {
                const inicioT = new Date(t.criada).getTime()
                const comecouAntes = inicioT < iniEixo
                const leadMs = t.segmentos.reduce((s, x) => s + x.ms, 0)
                const expandida = aberta === t.id
                const totais = expandida
                  ? totaisPorStatus(t.segmentos).sort((a, b) =>
                      statusCfg.findIndex(s => s.value === a.status) - statusCfg.findIndex(s => s.value === b.status))
                  : []
                return (
                  <div key={t.id} className="border-b border-gray-50 last:border-0">
                    <button
                      type="button"
                      onClick={() => setAberta(expandida ? null : t.id)}
                      className="w-full grid grid-cols-[minmax(0,1fr)_70px] md:grid-cols-[280px_minmax(0,1fr)_86px] items-center gap-0 px-0 py-0 text-left hover:bg-gray-50/50 transition-colors"
                    >
                      {/* título */}
                      <span className="flex items-center gap-1.5 px-4 py-2.5 min-w-0">
                        {expandida
                          ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          : <ChevronRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />}
                        <span className={cn('text-sm truncate', t.arquivada ? 'text-gray-400' : 'text-gray-800')} title={t.titulo}>
                          {t.titulo}
                        </span>
                      </span>

                      {/* barra segmentada (desktop) */}
                      <span className="relative h-9 hidden md:block">
                        {fds.map((f, i) => (
                          <span key={`f${i}`} className="absolute top-0 h-full bg-gray-50/80" style={{ left: `${f.pos}%`, width: `${f.w}%` }} />
                        ))}
                        {marcas.map((m, i) => (
                          <span key={i} className="absolute top-0 h-full border-l border-gray-50" style={{ left: `${m.pos}%` }} />
                        ))}
                        {comecouAntes && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[9px] text-gray-300 select-none">◂</span>
                        )}
                        {t.segmentos.map((s, i) => {
                          const a = Math.max(new Date(s.ini).getTime(), iniEixo)
                          const b = Math.min(new Date(s.fim).getTime(), fimEixo)
                          if (b <= a) return null
                          const c = cor(s.status)
                          return (
                            <span
                              key={i}
                              className="absolute top-1/2 -translate-y-1/2 h-4 first:rounded-l-md"
                              style={{
                                left: `${((a - iniEixo) / rangeMs) * 100}%`,
                                width: `max(${((b - a) / rangeMs) * 100}%, 3px)`,
                                backgroundColor: c.bg,
                                boxShadow: `inset 0 0 0 1px ${c.text}26`,
                              }}
                              title={`${c.label} — ${dataHoraBR(s.ini)} → ${dataHoraBR(s.fim)} (${fmtDuracao(s.ms)})`}
                            />
                          )
                        })}
                      </span>

                      {/* lead time total */}
                      <span className="px-3 py-2.5 text-right text-xs tabular-nums text-gray-500" title="Tempo total de processo (corrido)">
                        {fmtDuracao(leadMs)}
                      </span>
                    </button>

                    {expandida && (
                      <div className="px-11 pb-3 -mt-0.5">
                        <p className="text-[11px] text-gray-400 mb-1.5">
                          Criada em {dataBR(t.criada)}
                          {t.arquivada && ' · arquivada'}
                          {' · '}
                          <Link href={`/${orgSlug}/workspaces/${workspaceId}/campaigns/${t.campanhaId}/activities/${t.id}?from=${encodeURIComponent(pathname)}`} className="text-orange-600 hover:underline">
                            abrir tarefa
                          </Link>
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {totais.map(x => {
                            const c = cor(x.status)
                            return (
                              <span key={x.status}
                                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium"
                                style={{ backgroundColor: c.bg, color: c.text }}>
                                {c.label}
                                <b className="tabular-nums font-semibold">{fmtDuracao(x.ms)}</b>
                                {x.passagens > 1 && (
                                  <span className="inline-flex items-center gap-0.5 opacity-70" title={`${x.passagens} passagens por esta etapa`}>
                                    <Repeat2 className="w-3 h-3" />{x.passagens}×
                                  </span>
                                )}
                              </span>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-gray-400 mt-3">
        A barra usa as cores dos status da organização. Passagens repetidas pela mesma etapa somam no total
        (o contador ×N mostra as idas e voltas). Etapa em aberto corre até agora; concluída fecha na conclusão.
      </p>
    </div>
  )
}
