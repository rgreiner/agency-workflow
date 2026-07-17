'use client'

import { Fragment, useState, useTransition } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBRL, formatDateBR } from '@/lib/midia'
import { docNumero } from '@/lib/doc-series'
import { setProducaoSituacao } from '@/app/actions/producao'
import { setProducaoAnexos, type Anexo } from '@/app/actions/financeiro'
import { DocsBox, faltando } from './DocsBox'
import { FaturarButton } from './FaturarButton'

export interface ParcelaView { vencimento: string; valor: number }
export interface FeeView {
  id: string
  numero: number | null
  serie?: string | null
  titulo: string
  cliente: string
  total: number
  parcelas: ParcelaView[]
  anexos: Anexo[]
}

export function FaturamentoFeesTable({ orgSlug, fees }: { orgSlug: string; fees: FeeView[] }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
      <table className="w-full min-w-[720px]">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/50 text-xs font-medium text-gray-400">
            <th className="text-left px-4 py-3 w-20">Nº</th>
            <th className="text-left px-4 py-3">Fee</th>
            <th className="text-left px-4 py-3">Cliente</th>
            <th className="text-center px-4 py-3">Parcelas</th>
            <th className="text-right px-4 py-3">Total</th>
            <th className="w-36" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {fees.map(f => <FeeRow key={f.id} orgSlug={orgSlug} fee={f} />)}
        </tbody>
      </table>
    </div>
  )
}

function FeeRow({ orgSlug, fee }: { orgSlug: string; fee: FeeView }) {
  // Já nasce expandido — a conferência (datas + documentos) fica clara de cara.
  const [open, setOpen] = useState(true)
  const [anexos, setAnexos] = useState<Anexo[]>(fee.anexos)
  const [, startTransition] = useTransition()
  const n = fee.parcelas.length

  function persist(next: Anexo[]) {
    setAnexos(next)
    startTransition(async () => { await setProducaoAnexos(orgSlug, fee.id, next) })
  }

  return (
    <Fragment>
      <tr className={cn('transition', open ? 'bg-orange-50/40' : 'hover:bg-gray-50/50')}>
        <td className="px-4 py-3 text-sm text-gray-400 whitespace-nowrap tabular-nums">{docNumero(fee.serie, fee.numero)}</td>
        <td className="px-4 py-3 text-sm font-medium text-gray-900">{fee.titulo}</td>
        <td className="px-4 py-3 text-sm text-gray-600">{fee.cliente}</td>
        <td className="px-4 py-3 text-center">
          {n > 0 ? (
            <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100 active:scale-[0.97] transition">
              <ChevronRight className={cn('w-3.5 h-3.5 text-gray-400 transition-transform duration-200', open && 'rotate-90')} />
              {n}x
            </button>
          ) : <span className="text-sm text-gray-400">—</span>}
        </td>
        <td className="px-4 py-3 text-sm font-medium text-emerald-600 text-right">{formatBRL(fee.total)}</td>
        <td className="px-3 py-3 text-right">
          <FaturarButton
            missing={faltando(anexos)}
            okToast={n > 0 ? `${n} parcela(s) lançada(s) no financeiro.` : 'Fee lançado no financeiro.'}
            action={() => setProducaoSituacao(orgSlug, fee.id, 'faturado', 'financeiro/faturamento')}
          />
        </td>
      </tr>
      {open && (
        <tr className="bg-gray-50/40">
          <td colSpan={6} className="px-4 pb-4 pt-1">
            <div className="grid gap-3 lg:grid-cols-2">
              {n > 0 && (
                <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                  <div className="grid grid-cols-[auto_1fr_auto] gap-x-4 text-sm">
                    <div className="contents text-xs font-medium text-gray-400">
                      <div className="px-3 py-2 border-b border-gray-100">#</div>
                      <div className="px-3 py-2 border-b border-gray-100">Vencimento</div>
                      <div className="px-3 py-2 border-b border-gray-100 text-right">Valor</div>
                    </div>
                    {fee.parcelas.map((p, i) => (
                      <div key={i} className="contents">
                        <div className="px-3 py-2 border-b border-gray-50 text-gray-400 tabular-nums">{i + 1}/{n}</div>
                        <div className="px-3 py-2 border-b border-gray-50 text-gray-700 tabular-nums">{formatDateBR(p.vencimento)}</div>
                        <div className="px-3 py-2 border-b border-gray-50 text-gray-900 font-medium text-right tabular-nums">{formatBRL(p.valor)}</div>
                      </div>
                    ))}
                    <div className="contents">
                      <div className="px-3 py-2 text-xs font-medium text-gray-400" />
                      <div className="px-3 py-2 text-xs font-medium text-gray-500">Total ({n}x)</div>
                      <div className="px-3 py-2 text-right font-semibold text-gray-900 tabular-nums">{formatBRL(fee.total)}</div>
                    </div>
                  </div>
                </div>
              )}
              <DocsBox anexos={anexos} onChange={persist} />
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  )
}
