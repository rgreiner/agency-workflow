'use client'

import { Fragment, useState, useTransition } from 'react'
import Link from 'next/link'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBRL, formatDateBR } from '@/lib/midia'
import { docNumero } from '@/lib/doc-series'
import { setProducaoSituacao } from '@/app/actions/producao'
import { setProducaoAnexos, type Anexo } from '@/app/actions/financeiro'
import { DocsBox, faltando } from './DocsBox'
import { FaturarButton } from './FaturarButton'

export interface ParcelaView { vencimento: string; previstoAgencia: string; comissao: boolean; valor: number }
export interface FeeView {
  id: string
  tipo: string          // 'fee' | 'pedido' — define a rota do documento
  numero: number | null
  serie?: string | null
  titulo: string
  cliente: string
  aFaturar: number      // verde — o que a agência vai receber (a faturar)
  valorCliente: number  // cinza — valor cheio que o cliente paga (informativo)
  parcelas: ParcelaView[]
  anexos: Anexo[]
}

export function FaturamentoFeesTable({ orgSlug, fees }: { orgSlug: string; fees: FeeView[] }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
      <table className="w-full min-w-[860px]">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/50 text-xs font-medium text-gray-400">
            <th className="text-left px-4 py-3 w-20">Nº</th>
            <th className="text-left px-4 py-3">Item</th>
            <th className="text-left px-4 py-3">Cliente</th>
            <th className="text-center px-4 py-3">Parcelas</th>
            <th className="text-left px-4 py-3">Vencimento</th>
            <th className="text-right px-4 py-3">A faturar</th>
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
  const temComissao = fee.parcelas.some(p => p.comissao)
  // Cobrança = data da parcela; agência = recebimento no caixa (+dias na comissão).
  const cobrs = fee.parcelas.map(p => p.vencimento).filter(Boolean).sort()
  const agencias = fee.parcelas.map(p => p.previstoAgencia).filter(Boolean).sort()
  const fmtRange = (ds: string[]) => ds.length === 0 ? '—' : ds.length === 1 ? formatDateBR(ds[0]) : `${formatDateBR(ds[0])} → ${formatDateBR(ds[ds.length - 1])}`

  function persist(next: Anexo[]) {
    setAnexos(next)
    startTransition(async () => { await setProducaoAnexos(orgSlug, fee.id, next) })
  }

  return (
    <Fragment>
      <tr className={cn('transition', open ? 'bg-orange-50/40' : 'hover:bg-gray-50/50')}>
        <td className="px-4 py-3 whitespace-nowrap">
          <Link href={`/${orgSlug}/producao/${fee.tipo}/${fee.id}`} target="_blank"
            title="Abrir o documento em nova aba (somente leitura; não altera o status)"
            className="group/lnk inline-flex items-center gap-1 text-sm text-gray-500 hover:text-orange-600 tabular-nums transition-colors">
            {docNumero(fee.serie, fee.numero)}
            <ExternalLink className="w-3 h-3 opacity-0 group-hover/lnk:opacity-100 transition-opacity" />
          </Link>
        </td>
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
        <td className="px-4 py-3 text-sm whitespace-nowrap">
          {agencias.length === 0 ? (
            <span className="text-gray-300">—</span>
          ) : temComissao ? (
            <div className="leading-tight">
              <div className="text-gray-700 tabular-nums">{fmtRange(agencias)} <span className="text-[10px] text-gray-400 font-medium">agência</span></div>
              <div className="text-xs text-gray-400 tabular-nums">{fmtRange(cobrs)} cobrança</div>
            </div>
          ) : (
            <span className="text-gray-700 tabular-nums">{fmtRange(agencias)}</span>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          <div className="text-sm font-medium text-emerald-600 tabular-nums">{formatBRL(fee.aFaturar)}</div>
          {fee.valorCliente > fee.aFaturar + 0.005 && (
            <div className="text-xs text-gray-400 tabular-nums">cliente paga {formatBRL(fee.valorCliente)}</div>
          )}
        </td>
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
          <td colSpan={7} className="px-4 pb-4 pt-1">
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
                        <div className="px-3 py-2 border-b border-gray-50 text-gray-700 tabular-nums">
                          {formatDateBR(p.comissao ? p.previstoAgencia : p.vencimento)}
                          {p.comissao && <span className="text-xs text-gray-400"> · cobra {formatDateBR(p.vencimento)}</span>}
                        </div>
                        <div className="px-3 py-2 border-b border-gray-50 text-gray-900 font-medium text-right tabular-nums">{formatBRL(p.valor)}</div>
                      </div>
                    ))}
                    <div className="contents">
                      <div className="px-3 py-2 text-xs font-medium text-gray-400" />
                      <div className="px-3 py-2 text-xs font-medium text-gray-500">A faturar ({n}x)</div>
                      <div className="px-3 py-2 text-right font-semibold text-emerald-600 tabular-nums">{formatBRL(fee.aFaturar)}</div>
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
