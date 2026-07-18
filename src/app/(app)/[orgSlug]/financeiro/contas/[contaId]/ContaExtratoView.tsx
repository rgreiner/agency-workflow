'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ArrowDownCircle, ArrowUpCircle, Plug } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBRL, formatDateBR } from '@/lib/midia'

export interface Mov {
  data: string | null
  contato: string | null
  descricao: string | null
  categoria: string | null
  valor: number          // com sinal (despesa negativa), como vem do extrato
  situacao: string | null
}

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const REALIZADO = new Set(['Conciliado', 'Quitado', 'Transferido'])
const realizado = (s: string | null) => !!s && REALIZADO.has(s)
const monthOf = (d: string | null) => (d ? d.slice(0, 7) : null)
function monthLabel(ym: string) { const [y, m] = ym.split('-'); return `${MESES[Number(m) - 1]} ${y}` }
function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
function corSituacao(s: string | null): string {
  if (!s) return 'bg-gray-100 text-gray-500'
  if (REALIZADO.has(s)) return 'bg-emerald-50 text-emerald-700'
  if (s === 'Em aberto' || s === 'Atrasado') return 'bg-amber-50 text-amber-700'
  return 'bg-gray-100 text-gray-500'
}

export function ContaExtratoView({ movimentos, saldoInicial, saldoBanco, saldoBancoData, temOfx, today }: {
  movimentos: Mov[]; saldoInicial: number; saldoBanco: number | null; saldoBancoData: string | null
  temOfx: boolean; today: string
}) {
  const months = useMemo(() => {
    const set = new Set<string>()
    for (const m of movimentos) { const ym = monthOf(m.data); if (ym) set.add(ym) }
    return [...set].sort().reverse()
  }, [movimentos])

  const [mes, setMes] = useState(() => {
    const tm = today.slice(0, 7)
    if (months.includes(tm)) return tm
    const past = months.filter(m => m <= tm)
    return past[0] ?? months[0] ?? tm
  })

  // Saldo atual (inicial + realizado de todo o histórico) + saldo realizado ao fim de cada dia.
  const { saldoAtual, saldoAteDia } = useMemo(() => {
    const sorted = movimentos.filter(m => m.data).sort((a, b) => (a.data! < b.data! ? -1 : a.data! > b.data! ? 1 : 0))
    let acc = saldoInicial
    const map = new Map<string, number>()
    for (const m of sorted) { if (realizado(m.situacao)) acc += m.valor; map.set(m.data!, acc) }
    return { saldoAtual: acc, saldoAteDia: map }
  }, [movimentos, saldoInicial])

  const { dias, entradasMes, saidasMes } = useMemo(() => {
    const noMes = movimentos.filter(m => monthOf(m.data) === mes)
    let ent = 0, sai = 0
    for (const m of noMes) if (realizado(m.situacao)) { if (m.valor > 0) ent += m.valor; else sai += -m.valor }
    const byDay = new Map<string, Mov[]>()
    for (const m of noMes) { const k = m.data as string; const arr = byDay.get(k) ?? []; arr.push(m); byDay.set(k, arr) }
    const dias = [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([data, itens]) => ({ data, itens, saldo: saldoAteDia.get(data) ?? null }))
    return { dias, entradasMes: ent, saidasMes: sai }
  }, [movimentos, mes, saldoAteDia])

  const resultadoMes = entradasMes - saidasMes
  const diff = saldoBanco != null ? Math.round((saldoBanco - saldoAtual) * 100) / 100 : null

  return (
    <div className="p-6 space-y-5">
      {/* Saldo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-gray-200 px-5 py-4">
          <p className="text-xs font-medium text-gray-400 mb-1">Saldo atual</p>
          <p className={cn('text-2xl font-semibold tabular-nums', saldoAtual < 0 ? 'text-red-600' : 'text-gray-900')}>{formatBRL(saldoAtual)}</p>
          <p className="text-[11px] text-gray-400 mt-1">Inicial {formatBRL(saldoInicial)} + realizado do extrato</p>
          {saldoBanco != null && (
            <p className="text-[11px] mt-1.5">
              <span className="text-gray-500">No banco </span>
              <strong className="text-gray-700 tabular-nums">{formatBRL(saldoBanco)}</strong>
              {saldoBancoData ? <span className="text-gray-400"> em {formatDateBR(saldoBancoData)}</span> : null}
              {diff !== null && Math.abs(diff) >= 0.01 && (
                <span className={cn('ml-1 font-medium', diff < 0 ? 'text-red-600' : 'text-amber-600')}>· dif. {formatBRL(diff)}</span>
              )}
            </p>
          )}
        </div>
        <div className="bg-gray-50 rounded-2xl px-5 py-4">
          <p className="text-xs font-medium text-gray-400 mb-1">Entradas em {monthLabel(mes)}</p>
          <p className="text-xl font-semibold text-emerald-600 tabular-nums">{formatBRL(entradasMes)}</p>
        </div>
        <div className="bg-gray-50 rounded-2xl px-5 py-4">
          <p className="text-xs font-medium text-gray-400 mb-1">Saídas em {monthLabel(mes)}</p>
          <p className="text-xl font-semibold text-red-600 tabular-nums">{formatBRL(saidasMes)}</p>
        </div>
      </div>

      {/* Aviso OFX (some quando houver extrato bancário) */}
      {!temOfx && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-100 px-4 py-2.5 text-sm text-amber-800">
          <Plug className="w-4 h-4 shrink-0" />
          Sem OFX importado — o saldo do banco e a conciliação aparecem aqui quando você importar o extrato.
        </div>
      )}

      {/* Navegação de mês + resultado */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5">
          <button onClick={() => setMes(m => shiftMonth(m, -1))} className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition"><ChevronLeft className="w-4 h-4" /></button>
          <span className="px-3 text-sm font-medium text-gray-800 min-w-[120px] text-center">{monthLabel(mes)}</span>
          <button onClick={() => setMes(m => shiftMonth(m, 1))} className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition"><ChevronRight className="w-4 h-4" /></button>
        </div>
        <div className="text-sm text-gray-500">
          Resultado do mês <strong className={cn('font-medium tabular-nums', resultadoMes < 0 ? 'text-red-600' : 'text-emerald-600')}>{formatBRL(resultadoMes)}</strong>
        </div>
      </div>

      {/* Extrato por dia */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {dias.map(dia => (
          <div key={dia.data}>
            <div className="flex items-center justify-between px-4 py-2 bg-gray-50/70 border-t border-gray-100 first:border-t-0">
              <span className="text-xs font-medium text-gray-500">{formatDateBR(dia.data)}</span>
              {dia.saldo != null && <span className="text-[11px] text-gray-400 tabular-nums">saldo do dia {formatBRL(dia.saldo)}</span>}
            </div>
            {dia.itens.map((m, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-t border-gray-50">
                {m.valor < 0
                  ? <ArrowUpCircle className="w-4 h-4 text-red-400 shrink-0" />
                  : <ArrowDownCircle className="w-4 h-4 text-emerald-500 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-gray-800 truncate">{m.contato || m.descricao || '—'}</div>
                  <div className="flex flex-wrap items-center gap-1 mt-0.5">
                    {m.contato && m.descricao && <span className="text-[11px] text-gray-400 truncate">{m.descricao}</span>}
                    {m.categoria && <span className="text-[10px] text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">{m.categoria}</span>}
                    {m.situacao && <span className={cn('text-[10px] font-medium rounded-full px-2 py-0.5', corSituacao(m.situacao))}>{m.situacao}</span>}
                  </div>
                </div>
                <span className={cn('text-sm font-medium tabular-nums whitespace-nowrap', m.valor < 0 ? 'text-red-600' : 'text-gray-900')}>{formatBRL(m.valor)}</span>
              </div>
            ))}
          </div>
        ))}
        {dias.length === 0 && (
          <p className="text-sm text-gray-400 px-4 py-12 text-center">Nenhum movimento em {monthLabel(mes)}.</p>
        )}
      </div>
    </div>
  )
}
