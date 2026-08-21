'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarDays, Check, ChevronLeft, ChevronRight, Grid3x3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CoberturaRow, AgendaRow } from '@/app/actions/midia-hub'

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/** Cores por tipo de evento — verde é o que já aconteceu, laranja o que vence. */
const TIPO: Record<string, { chip: string; ponto: string; label: string }> = {
  feito:   { chip: 'bg-emerald-50 text-emerald-700 border-emerald-100', ponto: 'bg-emerald-500', label: 'feito' },
  prazo:   { chip: 'bg-orange-50 text-orange-700 border-orange-100',    ponto: 'bg-orange-500',  label: 'rotina' },
  entrega: { chip: 'bg-teal-50 text-teal-700 border-teal-100',          ponto: 'bg-teal-500',    label: 'entrega' },
  pedido:  { chip: 'bg-gray-100 text-gray-600 border-gray-200',         ponto: 'bg-gray-400',    label: 'pedido' },
}

function mesVizinho(ym: string, delta: number) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function AgendaMidia({ orgSlug, ym, diasNoMes, hoje, cobertura, agenda }: {
  orgSlug: string
  ym: string
  diasNoMes: number
  hoje: string
  cobertura: CoberturaRow[]
  agenda: AgendaRow[]
}) {
  const [visao, setVisao] = useState<'calendario' | 'cobertura'>('calendario')
  const [y, m] = ym.split('-').map(Number)

  // Progresso do ciclo: `least(feitas, esperado)` porque fazer 2 vezes a rotina
  // do mês não é 200% — é uma feita e uma repetição.
  const { feitas, esperado, pct } = useMemo(() => {
    const f = cobertura.reduce((s, c) => s + Math.min(c.feitas, c.esperado), 0)
    const e = cobertura.reduce((s, c) => s + c.esperado, 0)
    return { feitas: f, esperado: e, pct: e ? Math.round((f / e) * 100) : 0 }
  }, [cobertura])

  const porDia = useMemo(() => {
    const m = new Map<string, AgendaRow[]>()
    for (const ev of agenda) {
      const arr = m.get(ev.dia) ?? []
      arr.push(ev)
      m.set(ev.dia, arr)
    }
    return m
  }, [agenda])

  // Grade do mês começando no domingo (como a agenda que o time já usa).
  const primeiroDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
  const celulas: (number | null)[] = [
    ...Array(primeiroDow).fill(null),
    ...Array.from({ length: diasNoMes }, (_, i) => i + 1),
  ]
  while (celulas.length % 7 !== 0) celulas.push(null)

  const mesCorrente = hoje.slice(0, 7) === ym

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Agenda do mês</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            O que já foi feito e o que ainda vence — para nenhum cliente passar batido.
          </p>
        </div>
        <div className="inline-flex items-center gap-1 bg-white border border-gray-200 rounded-xl px-1 py-1">
          <Link href={`/${orgSlug}/midia/agenda?m=${mesVizinho(ym, -1)}`}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors" aria-label="Mês anterior">
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <span className="text-sm font-medium text-gray-800 min-w-[150px] text-center">
            {MESES[m - 1]} de {y}
          </span>
          <Link href={`/${orgSlug}/midia/agenda?m=${mesVizinho(ym, 1)}`}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors" aria-label="Próximo mês">
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {/* Avanço do ciclo — a resposta para "fechei tudo deste mês?" */}
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-end justify-between gap-3 flex-wrap mb-3">
          <div>
            <p className="text-[11px] text-gray-400">Rotinas do mês</p>
            <p className="text-2xl font-semibold text-gray-900 tabular-nums">
              {feitas} <span className="text-gray-300">de</span> {esperado}
            </p>
          </div>
          <p className={cn('text-sm font-medium tabular-nums',
            pct === 100 ? 'text-emerald-600' : pct >= 50 ? 'text-gray-600' : 'text-amber-600')}>
            {pct}% do ciclo
          </p>
        </div>
        <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
          <div className={cn('h-full rounded-full transition-[width] duration-500',
            pct === 100 ? 'bg-emerald-500' : 'bg-orange-500')}
            style={{ width: `${Math.max(pct, 1)}%` }} />
        </div>
      </section>

      <div className="inline-flex bg-gray-100 rounded-xl p-0.5">
        {([['calendario', 'Calendário', <CalendarDays key="c" className="w-4 h-4" />],
           ['cobertura', 'Por cliente', <Grid3x3 key="g" className="w-4 h-4" />]] as const).map(([v, label, icon]) => (
          <button key={v} onClick={() => setVisao(v)} aria-pressed={visao === v}
            className={cn('inline-flex items-center gap-2 px-3.5 py-1.5 text-sm font-medium rounded-[10px] transition-colors',
              visao === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
            {icon} {label}
          </button>
        ))}
      </div>

      {visao === 'calendario'
        ? <Calendario orgSlug={orgSlug} ym={ym} celulas={celulas} porDia={porDia} hoje={hoje} mesCorrente={mesCorrente} />
        : <Cobertura orgSlug={orgSlug} cobertura={cobertura} hoje={hoje} />}
    </div>
  )
}

function Calendario({ orgSlug, ym, celulas, porDia, hoje, mesCorrente }: {
  orgSlug: string; ym: string; celulas: (number | null)[]
  porDia: Map<string, AgendaRow[]>; hoje: string; mesCorrente: boolean
}) {
  const semanas: (number | null)[][] = []
  for (let i = 0; i < celulas.length; i += 7) semanas.push(celulas.slice(i, i + 7))

  return (
    <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="grid grid-cols-7 border-b border-gray-100">
        {SEMANA.map(d => (
          <div key={d} className="px-2 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wide text-center">
            {d}
          </div>
        ))}
      </div>

      {semanas.map((semana, i) => (
        <div key={i} className="grid grid-cols-7 border-b border-gray-50 last:border-0">
          {semana.map((dia, j) => {
            if (dia === null) return <div key={j} className="min-h-[104px] bg-gray-50/40" />
            const data = `${ym}-${String(dia).padStart(2, '0')}`
            const eventos = porDia.get(data) ?? []
            const ehHoje = mesCorrente && data === hoje
            const passado = data < hoje
            return (
              <div key={j} className={cn('min-h-[104px] p-1.5 border-r border-gray-50 last:border-r-0',
                ehHoje && 'bg-orange-50/40')}>
                <div className="flex items-center justify-between mb-1">
                  <span className={cn('text-xs tabular-nums w-6 h-6 inline-flex items-center justify-center rounded-full',
                    ehHoje ? 'bg-orange-600 text-[#fff] font-semibold'
                      : passado ? 'text-gray-300' : 'text-gray-600')}>
                    {dia}
                  </span>
                  {eventos.length > 3 && (
                    <span className="text-[10px] text-gray-400 tabular-nums">{eventos.length}</span>
                  )}
                </div>
                <div className="space-y-1">
                  {eventos.slice(0, 3).map((ev, k) => <Chip key={k} ev={ev} orgSlug={orgSlug} />)}
                  {eventos.length > 3 && (
                    <p className="text-[10px] text-gray-400 pl-1">+{eventos.length - 3} outros</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ))}

      <div className="flex items-center gap-4 flex-wrap px-4 py-3 border-t border-gray-100">
        {Object.entries(TIPO).map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
            <span className={cn('w-2 h-2 rounded-full', v.ponto)} /> {v.label}
          </span>
        ))}
      </div>
    </section>
  )
}

function Chip({ ev, orgSlug }: { ev: AgendaRow; orgSlug: string }) {
  const t = TIPO[ev.tipo] ?? TIPO.pedido
  const conteudo = (
    <span className={cn('block px-1.5 py-1 rounded-md border text-[10px] leading-tight truncate', t.chip)}
      title={`${ev.cliente} · ${ev.titulo}`}>
      <span className="font-medium">{ev.cliente}</span>
      <span className="block truncate opacity-80">{ev.titulo}</span>
    </span>
  )
  if (ev.tipo === 'entrega') {
    return <Link href={`/${orgSlug}/midia/entregas`} className="block hover:opacity-80 transition-opacity">{conteudo}</Link>
  }
  if (ev.activity_id && ev.workspace_id && ev.campaign_id) {
    return (
      <Link href={`/${orgSlug}/workspaces/${ev.workspace_id}/campaigns/${ev.campaign_id}/activities/${ev.activity_id}?from=${encodeURIComponent(`/${orgSlug}/midia/agenda`)}`}
        className="block hover:opacity-80 transition-opacity">
        {conteudo}
      </Link>
    )
  }
  return conteudo
}

/** Grade cliente × rotina: o buraco aparece a olho nu. */
function Cobertura({ orgSlug, cobertura, hoje }: {
  orgSlug: string; cobertura: CoberturaRow[]; hoje: string
}) {
  const clientes = useMemo(() => {
    const m = new Map<string, CoberturaRow[]>()
    for (const c of cobertura) {
      const arr = m.get(c.cliente) ?? []
      arr.push(c)
      m.set(c.cliente, arr)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
  }, [cobertura])

  // Colunas = as rotinas que existem em algum cliente, na ordem em que aparecem.
  const rotinas = useMemo(() => {
    const vistas = new Map<string, string>()
    for (const c of cobertura) if (!vistas.has(c.rotina_id)) vistas.set(c.rotina_id, c.rotina)
    return [...vistas.entries()]
  }, [cobertura])

  if (cobertura.length === 0) {
    return (
      <p className="text-sm text-gray-400 text-center py-16 bg-white border border-gray-200 rounded-xl">
        Nenhuma rotina ativa. Ative a mídia num cliente em &ldquo;Clientes e rotinas&rdquo;.
      </p>
    )
  }

  return (
    <section className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/50">
            <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide sticky left-0 bg-gray-50/50">
              Cliente
            </th>
            {rotinas.map(([id, nome]) => (
              <th key={id} className="px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide text-center">
                {nome}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {clientes.map(([cliente, linhas]) => (
            <tr key={cliente} className="hover:bg-gray-50/40">
              <td className="px-4 py-2.5 text-gray-800 font-medium sticky left-0 bg-white">{cliente}</td>
              {rotinas.map(([rid]) => {
                const c = linhas.find(l => l.rotina_id === rid)
                return <td key={rid} className="px-3 py-2.5 text-center">{c ? <Celula c={c} hoje={hoje} orgSlug={orgSlug} /> : <span className="text-gray-200">—</span>}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-gray-400 px-4 py-3 border-t border-gray-50">
        A célula conta quantas vezes a rotina aconteceu no mês contra quantas deveria — semanal em
        agosto são quatro, não uma. Traço quer dizer que o cliente não tem essa rotina ligada.
      </p>
    </section>
  )
}

function Celula({ c, hoje, orgSlug }: { c: CoberturaRow; hoje: string; orgSlug: string }) {
  const completa = c.feitas >= c.esperado
  const atrasada = !completa && !!c.prazo && c.prazo < hoje
  const rotulo = c.esperado > 1 ? `${Math.min(c.feitas, c.esperado)}/${c.esperado}` : null

  const corpo = (
    <span className={cn('inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium tabular-nums',
      completa ? 'bg-emerald-50 text-emerald-700'
        : atrasada ? 'bg-red-50 text-red-700'
        : 'bg-gray-100 text-gray-500')}>
      {completa && <Check className="w-3 h-3" />}
      {rotulo ?? (completa ? 'feito' : atrasada ? 'atrasada' : 'pendente')}
    </span>
  )

  const dica = `${c.rotina} · ${c.feitas} de ${c.esperado} no mês${c.prazo ? ` · próximo prazo ${c.prazo.slice(8, 10)}/${c.prazo.slice(5, 7)}` : ''}`
  return c.activity_id
    ? <Link href={`/${orgSlug}/midia`} title={dica} className="hover:opacity-80 transition-opacity">{corpo}</Link>
    : <span title={dica}>{corpo}</span>
}
