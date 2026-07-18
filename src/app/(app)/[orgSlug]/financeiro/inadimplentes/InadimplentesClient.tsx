'use client'

import { useMemo, useState } from 'react'
import { ChevronRight, Search, ArrowDownCircle, ArrowUpCircle, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBRL, formatDateBR } from '@/lib/midia'

export interface AbertoItem {
  id: string
  tipo: 'entrada' | 'saida'
  contato: string
  descricao: string | null
  categoria: string | null
  vencimento: string | null
  valor: number            // sempre positivo (módulo)
}

const diasAtraso = (venc: string | null, today: string) => {
  if (!venc || venc >= today) return 0
  const a = Date.UTC(+venc.slice(0, 4), +venc.slice(5, 7) - 1, +venc.slice(8, 10))
  const b = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}

interface Grupo { contato: string; itens: AbertoItem[]; subtotal: number; atrasado: number }

export function InadimplentesClient({ itens, today }: { itens: AbertoItem[]; today: string }) {
  const [tipo, setTipo] = useState<'entrada' | 'saida'>('entrada')
  const [query, setQuery] = useState('')
  const [soAtrasados, setSoAtrasados] = useState(false)
  const [open, setOpen] = useState<Set<string>>(new Set())

  const totais = useMemo(() => {
    let receber = 0, pagar = 0
    for (const i of itens) { if (i.tipo === 'entrada') receber += i.valor; else pagar += i.valor }
    return { receber, pagar }
  }, [itens])

  const grupos = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtrados = itens.filter(i => {
      if (i.tipo !== tipo) return false
      if (soAtrasados && diasAtraso(i.vencimento, today) === 0) return false
      if (q && !`${i.contato} ${i.descricao ?? ''} ${i.categoria ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
    const map = new Map<string, Grupo>()
    for (const i of filtrados) {
      const key = i.contato
      const g = map.get(key) ?? { contato: key, itens: [], subtotal: 0, atrasado: 0 }
      g.itens.push(i)
      g.subtotal += i.valor
      if (diasAtraso(i.vencimento, today) > 0) g.atrasado += i.valor
      map.set(key, g)
    }
    const arr = [...map.values()]
    arr.forEach(g => g.itens.sort((a, b) => (a.vencimento ?? '9999') < (b.vencimento ?? '9999') ? -1 : 1))
    arr.sort((a, b) => b.subtotal - a.subtotal)
    return arr
  }, [itens, tipo, query, soAtrasados, today])

  const total = useMemo(() => grupos.reduce((s, g) => s + g.subtotal, 0), [grupos])
  const totalAtrasado = useMemo(() => grupos.reduce((s, g) => s + g.atrasado, 0), [grupos])
  const nItens = useMemo(() => grupos.reduce((s, g) => s + g.itens.length, 0), [grupos])

  function toggle(k: string) {
    setOpen(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })
  }

  const isReceber = tipo === 'entrada'

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-gray-900">Inadimplentes</h1>
        <p className="text-gray-500 text-sm mt-0.5">Tudo que está em aberto, por cliente / fornecedor — independe do mês</p>
      </div>

      {/* Cards de total */}
      <div className="grid grid-cols-2 gap-3 mb-5 max-w-xl">
        <button type="button" onClick={() => setTipo('entrada')}
          className={cn('text-left rounded-xl border bg-white px-4 py-3 transition-colors',
            isReceber ? 'border-orange-300 ring-2 ring-orange-200' : 'border-gray-200 hover:border-gray-300')}>
          <p className="text-[11px] font-medium text-gray-400 mb-1">A receber em aberto</p>
          <p className="text-base font-semibold text-emerald-600">{formatBRL(totais.receber)}</p>
        </button>
        <button type="button" onClick={() => setTipo('saida')}
          className={cn('text-left rounded-xl border bg-white px-4 py-3 transition-colors',
            !isReceber ? 'border-orange-300 ring-2 ring-orange-200' : 'border-gray-200 hover:border-gray-300')}>
          <p className="text-[11px] font-medium text-gray-400 mb-1">A pagar em aberto</p>
          <p className="text-base font-semibold text-red-600">{formatBRL(totais.pagar)}</p>
        </button>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="inline-flex bg-gray-100 rounded-xl p-0.5">
          {([['entrada', 'A receber (clientes)'], ['saida', 'A pagar (fornecedores)']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setTipo(v)} aria-pressed={tipo === v}
              className={cn('px-3 py-1.5 text-sm font-medium rounded-[10px] transition-colors',
                tipo === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
              {label}
            </button>
          ))}
        </div>
        <label className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl border cursor-pointer transition-colors',
          soAtrasados ? 'border-red-200 bg-red-50 text-red-700' : 'border-gray-200 text-gray-500 hover:text-gray-700')}>
          <input type="checkbox" checked={soAtrasados} onChange={e => setSoAtrasados(e.target.checked)} className="sr-only" />
          <AlertTriangle className="w-3.5 h-3.5" /> Só atrasados
        </label>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por contato, descrição ou categoria"
            className="w-full pl-9 pr-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
        </div>
      </div>

      {/* Barra de total do recorte */}
      <div className="flex items-center justify-between gap-3 mb-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <span className="text-sm text-gray-500">
          {grupos.length} {isReceber ? 'cliente(s)' : 'fornecedor(es)'} · {nItens} título(s)
          {totalAtrasado > 0 && <span className="text-red-600 font-medium"> · {formatBRL(totalAtrasado)} atrasado</span>}
        </span>
        <span className={cn('text-base font-semibold tabular-nums', isReceber ? 'text-emerald-600' : 'text-red-600')}>{formatBRL(total)}</span>
      </div>

      {/* Grupos */}
      <div className="space-y-2">
        {grupos.map(g => {
          const aberto = open.has(g.contato)
          const temAtraso = g.atrasado > 0
          return (
            <div key={g.contato} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <button type="button" onClick={() => toggle(g.contato)}
                className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-50/50 transition">
                <ChevronRight className={cn('w-4 h-4 text-gray-400 transition-transform shrink-0', aberto && 'rotate-90')} />
                {isReceber ? <ArrowDownCircle className="w-4 h-4 text-emerald-500 shrink-0" /> : <ArrowUpCircle className="w-4 h-4 text-red-400 shrink-0" />}
                <span className="text-sm font-medium text-gray-900 truncate">{g.contato}</span>
                <span className="text-xs text-gray-400 shrink-0">{g.itens.length} título(s)</span>
                {temAtraso && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-red-700 bg-red-50 rounded-full px-1.5 py-0.5 shrink-0">
                    <AlertTriangle className="w-2.5 h-2.5" /> {formatBRL(g.atrasado)} atrasado
                  </span>
                )}
                <span className={cn('ml-auto text-sm font-semibold tabular-nums shrink-0', isReceber ? 'text-emerald-600' : 'text-red-600')}>{formatBRL(g.subtotal)}</span>
              </button>

              {aberto && (
                <div className="border-t border-gray-100 divide-y divide-gray-50">
                  {g.itens.map(i => {
                    const atraso = diasAtraso(i.vencimento, today)
                    return (
                      <div key={i.id} className="flex items-center gap-3 px-4 py-2.5 pl-11">
                        <div className="w-24 shrink-0">
                          <div className={cn('text-sm tabular-nums', atraso > 0 ? 'text-red-600 font-medium' : 'text-gray-600')}>{formatDateBR(i.vencimento)}</div>
                          {atraso > 0 && <div className="text-[10px] text-red-500">{atraso} dia{atraso > 1 ? 's' : ''} atrás</div>}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-gray-800 truncate">{i.descricao || i.categoria || '—'}</div>
                          {i.descricao && i.categoria && <div className="text-[11px] text-gray-400 truncate">{i.categoria}</div>}
                        </div>
                        <span className="text-sm font-medium tabular-nums text-gray-900 shrink-0">{formatBRL(i.valor)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
        {grupos.length === 0 && (
          <p className="text-sm text-gray-400 px-4 py-12 text-center bg-white rounded-xl border border-gray-200">
            Nada em aberto {isReceber ? 'a receber' : 'a pagar'}{soAtrasados ? ' e atrasado' : ''}.
          </p>
        )}
      </div>
    </div>
  )
}
