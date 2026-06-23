'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Archive, ArchiveRestore, Megaphone, Pencil, Printer } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { setMidiaSituacao, setMidiaArchived } from '@/app/actions/midia'
import {
  MIDIA_TIPO_OPTIONS, MIDIA_SITUACAO_OPTIONS, MIDIA_SITUACAO_COLORS, labelOf, formatBRL,
} from '@/lib/midia'

export interface MidiaRow {
  id: string; numero: number | null; titulo: string; tipo: string | null
  valor: number; desconto_pct: number; faturamento: string | null
  situacao: string; archived: boolean; cliente: string; veiculo: string
}

export function MidiasClient({
  orgSlug, midias, archivedView,
  basePath = 'midias/simplificada',
  title = 'Liberação de mídias — Simplificada',
  subtitle = 'Autorizações de mídia (todos os tipos)',
  addLabel = 'Adicionar Mídia Simplificada',
  addOptions,
  editHrefFor,
}: {
  orgSlug: string; midias: MidiaRow[]; archivedView: boolean
  basePath?: string; title?: string; subtitle?: string; addLabel?: string
  /** Vários botões de "Adicionar" (ex.: Jornal/Revista). Se ausente, usa addLabel → base/nova. */
  addOptions?: { label: string; href: string }[]
  /** Link de edição por linha (ex.: Jornal vai pra rota diferente). Default base/id. */
  editHrefFor?: (m: MidiaRow) => string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const base = `/${orgSlug}/${basePath}`
  const editHref = (m: MidiaRow) => (editHrefFor ? editHrefFor(m) : `${base}/${m.id}`)

  function changeSituacao(id: string, situacao: string) {
    startTransition(async () => { await setMidiaSituacao(orgSlug, id, situacao); router.refresh() })
  }
  function archive(m: MidiaRow) {
    startTransition(async () => { await setMidiaArchived(orgSlug, m.id, !m.archived); router.refresh() })
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
            <Link href={base}
              className={cn('px-2.5 py-1 rounded-md transition', !archivedView ? 'bg-gray-900 text-[#fff]' : 'text-gray-500 hover:text-gray-700')}>Ativas</Link>
            <Link href={`${base}?view=arquivadas`}
              className={cn('px-2.5 py-1 rounded-md transition', archivedView ? 'bg-gray-900 text-[#fff]' : 'text-gray-500 hover:text-gray-700')}>Arquivadas</Link>
          </div>
          {!archivedView && (addOptions && addOptions.length > 0 ? (
            addOptions.map(opt => (
              <Link key={opt.href} href={opt.href}
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-indigo-700 transition">
                <Plus className="w-4 h-4" /> {opt.label}
              </Link>
            ))
          ) : (
            <Link href={`${base}/nova`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-indigo-700 transition">
              <Plus className="w-4 h-4" /> {addLabel}
            </Link>
          ))}
        </div>
      </div>

      {midias.length > 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50 text-xs font-medium text-gray-400">
                <th className="text-left px-4 py-3 w-14">Nº</th>
                <th className="text-left px-4 py-3">Título</th>
                <th className="text-left px-4 py-3">Cliente</th>
                <th className="text-left px-4 py-3">Veículo</th>
                <th className="text-left px-4 py-3">Tipo</th>
                <th className="text-right px-4 py-3">Valor</th>
                <th className="text-right px-4 py-3">Comissão</th>
                <th className="text-left px-4 py-3 w-44">Situação</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {midias.map(m => {
                const comissao = m.valor * (m.desconto_pct / 100)
                const cor = MIDIA_SITUACAO_COLORS[m.situacao]
                return (
                  <tr key={m.id} className="hover:bg-gray-50/50 transition">
                    <td className="px-4 py-3 text-sm text-gray-400">{m.numero ?? '—'}</td>
                    <td className="px-4 py-3 text-sm font-medium">
                      <Link href={editHref(m)} className="text-gray-900 hover:text-indigo-600 transition">
                        {m.titulo}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{m.cliente}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{m.veiculo}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{labelOf(MIDIA_TIPO_OPTIONS, m.tipo)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 text-right">{formatBRL(m.valor)}</td>
                    <td className="px-4 py-3 text-sm text-gray-900 text-right font-medium">{formatBRL(comissao)}</td>
                    <td className="px-4 py-3">
                      {archivedView ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
                          style={{ backgroundColor: cor?.bg, color: cor?.text }}>
                          {labelOf(MIDIA_SITUACAO_OPTIONS, m.situacao)}
                        </span>
                      ) : (
                        <Select size="sm" value={m.situacao} onChange={v => changeSituacao(m.id, v)} options={MIDIA_SITUACAO_OPTIONS} />
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <Link href={`${base}/${m.id}/print`}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition" title="Imprimir / PDF">
                          <Printer className="w-3.5 h-3.5" />
                        </Link>
                        <Link href={editHref(m)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition" title="Editar">
                          <Pencil className="w-3.5 h-3.5" />
                        </Link>
                        <button onClick={() => archive(m)} disabled={isPending}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition disabled:opacity-50"
                          title={m.archived ? 'Desarquivar' : 'Arquivar'}>
                          {m.archived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-24 bg-white rounded-xl border border-gray-200">
          <Megaphone className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-gray-900 font-medium">{archivedView ? 'Nenhuma mídia arquivada' : 'Nenhuma mídia ainda'}</h3>
          <p className="text-gray-500 text-sm mt-1">{archivedView ? 'Mídias arquivadas aparecem aqui.' : 'Adicione a primeira liberação de mídia.'}</p>
        </div>
      )}
    </div>
  )
}
