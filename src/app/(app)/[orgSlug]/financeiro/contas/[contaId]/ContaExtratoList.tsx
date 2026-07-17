'use client'

import { useState } from 'react'
import { ChevronRight, FileSpreadsheet } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBRL, formatDateBR } from '@/lib/midia'

export interface ExtratoMov {
  data: string | null
  contato: string | null
  descricao: string | null
  categoria: string | null
  valor: number        // com sinal (despesa negativa)
  situacao: string | null
}

const REALIZADO = new Set(['Conciliado', 'Quitado', 'Transferido'])
function corSituacao(s: string | null): string {
  if (!s) return 'bg-gray-100 text-gray-500'
  if (REALIZADO.has(s)) return 'bg-emerald-50 text-emerald-700'
  if (s === 'Em aberto' || s === 'Atrasado') return 'bg-amber-50 text-amber-700'
  return 'bg-gray-100 text-gray-500'
}

export function ContaExtratoList({ movimentos }: { movimentos: ExtratoMov[] }) {
  const [open, setOpen] = useState(false)
  if (movimentos.length === 0) return null

  const total = movimentos.reduce((s, m) => s + m.valor, 0)

  return (
    <div className="px-6 pt-4">
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-50/50 transition"
        >
          <ChevronRight className={cn('w-4 h-4 text-gray-400 transition-transform', open && 'rotate-90')} />
          <FileSpreadsheet className="w-4 h-4 text-sky-600 shrink-0" />
          <span className="text-sm font-medium text-gray-800">Extrato do Conta Azul</span>
          <span className="text-xs text-gray-400">{movimentos.length} movimento(s)</span>
          <span className={cn('ml-auto text-sm font-medium tabular-nums', total < 0 ? 'text-red-600' : 'text-gray-700')}>{formatBRL(total)}</span>
        </button>

        {open && (
          <div className="max-h-[60vh] overflow-y-auto border-t border-gray-100">
            <table className="w-full min-w-[640px]">
              <thead className="sticky top-0 bg-gray-50/90 backdrop-blur">
                <tr className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                  <th className="text-left px-4 py-2 w-24">Data</th>
                  <th className="text-left px-4 py-2">Movimento</th>
                  <th className="text-left px-4 py-2 w-32">Situação</th>
                  <th className="text-right px-4 py-2 w-32">Valor</th>
                </tr>
              </thead>
              <tbody>
                {movimentos.map((m, i) => (
                  <tr key={i} className="border-t border-gray-50">
                    <td className="px-4 py-2 text-sm text-gray-500 tabular-nums whitespace-nowrap">{formatDateBR(m.data ?? undefined)}</td>
                    <td className="px-4 py-2 text-sm">
                      <span className="text-gray-800">{m.contato || m.descricao || '—'}</span>
                      <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
                        {m.contato && m.descricao && <span className="text-xs text-gray-400">{m.descricao}</span>}
                        {m.categoria && <span className="text-[10px] text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">{m.categoria}</span>}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {m.situacao && <span className={cn('inline-flex text-[11px] font-medium px-2 py-0.5 rounded-full', corSituacao(m.situacao))}>{m.situacao}</span>}
                    </td>
                    <td className={cn('px-4 py-2 text-sm text-right font-medium tabular-nums whitespace-nowrap', m.valor < 0 ? 'text-red-600' : 'text-gray-900')}>{formatBRL(m.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
