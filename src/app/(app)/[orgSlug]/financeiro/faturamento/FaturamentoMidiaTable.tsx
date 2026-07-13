'use client'

import { Fragment, useState, useTransition } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBRL, formatDateBR } from '@/lib/midia'
import { lancarMidia, setMidiaAnexos, type Anexo } from '@/app/actions/financeiro'
import { DocsBox, faltando } from './DocsBox'
import { FaturarButton } from './FaturarButton'

export interface MidiaView {
  id: string
  numero: number | null
  titulo: string
  cliente: string
  veiculo: string
  valorDoc: number
  comissao: number
  pagador: string
  competencia: string
  vencimento: string
  anexos: Anexo[]
}

export function FaturamentoMidiaTable({ orgSlug, midias }: { orgSlug: string; midias: MidiaView[] }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
      <table className="w-full min-w-[820px]">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/50 text-xs font-medium text-gray-400">
            <th className="text-left px-4 py-3 w-16">Nº</th>
            <th className="text-left px-4 py-3">Título</th>
            <th className="text-left px-4 py-3">Cliente</th>
            <th className="text-left px-4 py-3">Veículo</th>
            <th className="text-right px-4 py-3">Valor doc.</th>
            <th className="text-right px-4 py-3">Comissão</th>
            <th className="w-32" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {midias.map(m => <MidiaRow key={m.id} orgSlug={orgSlug} midia={m} />)}
        </tbody>
      </table>
    </div>
  )
}

function MidiaRow({ orgSlug, midia }: { orgSlug: string; midia: MidiaView }) {
  const [open, setOpen] = useState(true)
  const [anexos, setAnexos] = useState<Anexo[]>(midia.anexos)
  const [, startTransition] = useTransition()

  function persist(next: Anexo[]) {
    setAnexos(next)
    startTransition(async () => { await setMidiaAnexos(orgSlug, midia.id, next) })
  }

  return (
    <Fragment>
      <tr className={cn('transition', open ? 'bg-orange-50/40' : 'hover:bg-gray-50/50')}>
        <td className="px-4 py-3 text-sm text-gray-400">{midia.numero ?? '—'}</td>
        <td className="px-4 py-3 text-sm font-medium text-gray-900">
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="inline-flex items-center gap-1 hover:text-orange-600 transition">
            <ChevronRight className={cn('w-3.5 h-3.5 text-gray-400 transition-transform duration-200', open && 'rotate-90')} />
            {midia.titulo}
          </button>
        </td>
        <td className="px-4 py-3 text-sm text-gray-600">{midia.cliente}</td>
        <td className="px-4 py-3 text-sm text-gray-600">{midia.veiculo}</td>
        <td className="px-4 py-3 text-sm text-gray-600 text-right tabular-nums">{formatBRL(midia.valorDoc)}</td>
        <td className="px-4 py-3 text-sm font-medium text-emerald-600 text-right tabular-nums">{formatBRL(midia.comissao)}</td>
        <td className="px-3 py-3 text-right">
          <FaturarButton
            missing={faltando(anexos)}
            okToast="Comissão lançada no financeiro."
            action={() => lancarMidia(orgSlug, midia.id)}
          />
        </td>
      </tr>
      {open && (
        <tr className="bg-gray-50/40">
          <td colSpan={7} className="px-4 pb-4 pt-1">
            <div className="grid gap-3 lg:grid-cols-2">
              <dl className="rounded-xl border border-gray-100 bg-white p-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm self-start">
                <div><dt className="text-xs text-gray-400">Comissão (cobrar de)</dt><dd className="text-gray-700">{midia.pagador}</dd></div>
                <div><dt className="text-xs text-gray-400">Competência</dt><dd className="text-gray-700 tabular-nums">{formatDateBR(midia.competencia)}</dd></div>
                <div><dt className="text-xs text-gray-400">Vencimento (dias agência)</dt><dd className="text-gray-900 font-medium tabular-nums">{formatDateBR(midia.vencimento)}</dd></div>
                <div><dt className="text-xs text-gray-400">Comissão</dt><dd className="text-emerald-600 font-medium tabular-nums">{formatBRL(midia.comissao)}</dd></div>
              </dl>
              <DocsBox anexos={anexos} onChange={persist} />
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  )
}
