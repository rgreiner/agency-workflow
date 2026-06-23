'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, FileText, Receipt, Check, RotateCcw, AlertTriangle, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBRL, formatDateBR } from '@/lib/midia'
import { setLancamentoSituacao, setLancamentoFlags, ressincronizarLancamento, marcarLancamentoRevisado } from '@/app/actions/financeiro'

export interface Lancamento {
  id: string
  tipo: string
  origem_tipo: string | null
  contato_nome: string | null
  descricao: string | null
  valor: number | string
  vencimento: string | null
  competencia: string | null
  situacao: string
  nf_emitida: boolean
  boleto_gerado: boolean
  revisar: boolean
}

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

function monthLabel(ym: string) {
  const [y, m] = ym.split('-')
  return `${MESES[Number(m) - 1]} ${y}`
}
function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
const isPago = (s: string) => s === 'pago' || s === 'recebido'
const monthOf = (d: string | null) => (d ? d.slice(0, 7) : null)
const val = (l: Lancamento) => Number(l.valor ?? 0)

export function LancamentosClient({ orgSlug, lancamentos, today }: {
  orgSlug: string; lancamentos: Lancamento[]; today: string
}) {
  const [mes, setMes] = useState(today.slice(0, 7))

  const { atrasado, aVencer, pagos } = useMemo(() => {
    const atrasado = lancamentos.filter(l => !isPago(l.situacao) && l.vencimento && l.vencimento < today)
    const aVencer = lancamentos.filter(l => !isPago(l.situacao) && (!l.vencimento || (monthOf(l.vencimento) === mes && l.vencimento >= today)))
    const pagos = lancamentos.filter(l => isPago(l.situacao) && monthOf(l.vencimento) === mes)
    return { atrasado, aVencer, pagos }
  }, [lancamentos, mes, today])

  const sum = (arr: Lancamento[]) => arr.reduce((s, l) => s + val(l), 0)
  const revisarCount = lancamentos.filter(l => l.revisar).length

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Lançamentos</h1>
          <p className="text-gray-500 text-sm mt-0.5">Controle mensal — NF, boleto e recebimento</p>
        </div>
        <div className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5">
          <button onClick={() => setMes(m => shiftMonth(m, -1))} className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition"><ChevronLeft className="w-4 h-4" /></button>
          <span className="px-3 text-sm font-medium text-gray-800 min-w-[120px] text-center">{monthLabel(mes)}</span>
          <button onClick={() => setMes(m => shiftMonth(m, 1))} className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>

      {revisarCount > 0 && (
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span><strong>{revisarCount}</strong> lançamento(s) com o documento alterado depois de lançado — revise (atualizar do documento ou marcar revisado).</span>
        </div>
      )}

      <Bucket title="Atrasado" tone="red" total={sum(atrasado)} items={atrasado} orgSlug={orgSlug} today={today} emptyHint="Nada atrasado." />
      <Bucket title={`A vencer em ${monthLabel(mes)}`} tone="amber" total={sum(aVencer)} items={aVencer} orgSlug={orgSlug} today={today} emptyHint="Nada a vencer neste mês." />
      <Bucket title={`Pago em ${monthLabel(mes)}`} tone="emerald" total={sum(pagos)} items={pagos} orgSlug={orgSlug} today={today} emptyHint="Nada pago neste mês." paid />
    </div>
  )
}

function Bucket({ title, tone, total, items, orgSlug, today, emptyHint, paid = false }: {
  title: string; tone: 'red' | 'amber' | 'emerald'; total: number; items: Lancamento[]
  orgSlug: string; today: string; emptyHint: string; paid?: boolean
}) {
  const toneCls = {
    red: 'text-red-700 bg-red-50 border-red-100',
    amber: 'text-amber-700 bg-amber-50 border-amber-100',
    emerald: 'text-emerald-700 bg-emerald-50 border-emerald-100',
  }[tone]

  return (
    <div className="mb-5">
      <div className={cn('flex items-center justify-between px-4 py-2 rounded-t-xl border text-sm font-semibold', toneCls)}>
        <span>{title} · {items.length}</span>
        <span>{formatBRL(total)}</span>
      </div>
      <div className="bg-white rounded-b-xl border border-t-0 border-gray-200 overflow-hidden overflow-x-auto">
        {items.length > 0 ? (
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="border-b border-gray-100 text-xs font-medium text-gray-400">
                <th className="text-left px-4 py-2">Vencimento</th>
                <th className="text-left px-4 py-2">Contato</th>
                <th className="text-left px-4 py-2">Descrição</th>
                <th className="text-right px-4 py-2">Valor</th>
                <th className="text-center px-3 py-2">NF</th>
                <th className="text-center px-3 py-2">Boleto</th>
                <th className="w-28" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map(l => <Row key={l.id} l={l} orgSlug={orgSlug} today={today} paid={paid} />)}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-400 px-4 py-5">{emptyHint}</p>
        )}
      </div>
    </div>
  )
}

function Row({ l, orgSlug, today, paid }: { l: Lancamento; orgSlug: string; today: string; paid: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const overdue = !paid && !!l.vencimento && l.vencimento < today

  function toggleNf() {
    startTransition(async () => { await setLancamentoFlags(orgSlug, l.id, !l.nf_emitida, l.boleto_gerado); router.refresh() })
  }
  function toggleBoleto() {
    startTransition(async () => { await setLancamentoFlags(orgSlug, l.id, l.nf_emitida, !l.boleto_gerado); router.refresh() })
  }
  function togglePago() {
    startTransition(async () => { await setLancamentoSituacao(orgSlug, l.id, paid ? 'em_aberto' : 'pago'); router.refresh() })
  }
  function atualizarDoDoc() {
    startTransition(async () => { await ressincronizarLancamento(orgSlug, l.id); router.refresh() })
  }
  function marcarRevisado() {
    startTransition(async () => { await marcarLancamentoRevisado(orgSlug, l.id); router.refresh() })
  }

  return (
    <tr className={cn('transition', isPending ? 'opacity-50' : 'hover:bg-gray-50/50', l.revisar && 'bg-amber-50/40')}>
      <td className={cn('px-4 py-2.5 text-sm', overdue ? 'text-red-600 font-medium' : 'text-gray-600')}>{formatDateBR(l.vencimento)}</td>
      <td className="px-4 py-2.5 text-sm text-gray-900">
        {l.contato_nome ?? '—'}
        {l.revisar && <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 text-[10px] font-medium px-1.5 py-0.5 align-middle"><AlertTriangle className="w-2.5 h-2.5" /> alterado</span>}
      </td>
      <td className="px-4 py-2.5 text-sm text-gray-600">{l.descricao ?? '—'}</td>
      <td className="px-4 py-2.5 text-sm font-medium text-gray-900 text-right">{formatBRL(val(l))}</td>
      <td className="px-3 py-2.5 text-center"><Flag on={l.nf_emitida} onClick={toggleNf} label="NF" /></td>
      <td className="px-3 py-2.5 text-center"><Flag on={l.boleto_gerado} onClick={toggleBoleto} label="Boleto" /></td>
      <td className="px-3 py-2.5">
        <div className="flex items-center justify-end gap-1.5">
          {l.revisar && (
            <>
              <button onClick={atualizarDoDoc} disabled={isPending} title="Atualizar do documento"
                className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 transition disabled:opacity-50">
                <RefreshCw className="w-3.5 h-3.5" /> Atualizar
              </button>
              <button onClick={marcarRevisado} disabled={isPending} title="Marcar como revisado"
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition disabled:opacity-50">
                <Check className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          <button onClick={togglePago} disabled={isPending}
            className={cn('inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition disabled:opacity-50',
              paid ? 'text-gray-500 hover:bg-gray-100' : 'bg-emerald-600 text-[#fff] hover:bg-emerald-700')}>
            {paid ? <><RotateCcw className="w-3.5 h-3.5" /> Reabrir</> : <><Check className="w-3.5 h-3.5" /> Pago</>}
          </button>
        </div>
      </td>
    </tr>
  )
}

function Flag({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  const Icon = label === 'NF' ? FileText : Receipt
  return (
    <button onClick={onClick} title={label}
      className={cn('inline-flex items-center justify-center w-7 h-7 rounded-lg border transition',
        on ? 'bg-indigo-600 border-indigo-600 text-[#fff]' : 'border-gray-200 text-gray-300 hover:text-gray-500')}>
      <Icon className="w-3.5 h-3.5" />
    </button>
  )
}
