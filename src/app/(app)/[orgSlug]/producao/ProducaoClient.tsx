'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Archive, ArchiveRestore, Pencil, ClipboardList, Printer, Factory } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { setProducaoSituacao, setProducaoArchived, gerarPedidosDoOrcamento } from '@/app/actions/producao'
import { MIDIA_SITUACAO_OPTIONS, MIDIA_SITUACAO_COLORS, labelOf, formatBRL } from '@/lib/midia'

export interface ProducaoRow {
  id: string; numero: number | null; titulo: string; valor: number
  situacao: string; archived: boolean; cliente: string
}

export function ProducaoClient({
  orgSlug, items, archivedView, basePath, title, subtitle, addLabel, gerarPedidos = false, showPrint = true,
}: {
  orgSlug: string; items: ProducaoRow[]; archivedView: boolean
  basePath: string; title: string; subtitle: string; addLabel: string
  /** Mostra "Gerar PPs" nos orçamentos aprovados. */
  gerarPedidos?: boolean
  /** Mostra o botão de imprimir/PDF (false enquanto o tipo não tiver impressão). */
  showPrint?: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const base = `/${orgSlug}/${basePath}`

  const changeSituacao = (id: string, s: string) => startTransition(async () => { await setProducaoSituacao(orgSlug, id, s, basePath); router.refresh() })
  const archive = (r: ProducaoRow) => startTransition(async () => { await setProducaoArchived(orgSlug, r.id, !r.archived, basePath); router.refresh() })
  const gerarPPs = (r: ProducaoRow) => startTransition(async () => { const res = await gerarPedidosDoOrcamento(orgSlug, r.id); if (res?.error) alert(res.error) })

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
            <Link href={base} className={cn('px-2.5 py-1 rounded-md transition', !archivedView ? 'bg-gray-900 text-[#fff]' : 'text-gray-500 hover:text-gray-700')}>Ativos</Link>
            <Link href={`${base}?view=arquivados`} className={cn('px-2.5 py-1 rounded-md transition', archivedView ? 'bg-gray-900 text-[#fff]' : 'text-gray-500 hover:text-gray-700')}>Arquivados</Link>
          </div>
          {!archivedView && (
            <Link href={`${base}/nova`} className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-indigo-700 transition">
              <Plus className="w-4 h-4" /> {addLabel}
            </Link>
          )}
        </div>
      </div>

      {items.length > 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50 text-xs font-medium text-gray-400">
                <th className="text-left px-4 py-3 w-14">Nº</th>
                <th className="text-left px-4 py-3">Título</th>
                <th className="text-left px-4 py-3">Cliente</th>
                <th className="text-right px-4 py-3">Valor</th>
                <th className="text-left px-4 py-3 w-44">Situação</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map(r => {
                const cor = MIDIA_SITUACAO_COLORS[r.situacao]
                return (
                  <tr key={r.id} className="hover:bg-gray-50/50 transition">
                    <td className="px-4 py-3 text-sm text-gray-400">{r.numero ?? '—'}</td>
                    <td className="px-4 py-3 text-sm font-medium"><Link href={`${base}/${r.id}`} className="text-gray-900 hover:text-indigo-600 transition">{r.titulo}</Link></td>
                    <td className="px-4 py-3 text-sm text-gray-600">{r.cliente}</td>
                    <td className="px-4 py-3 text-sm text-gray-900 text-right font-medium">{formatBRL(r.valor)}</td>
                    <td className="px-4 py-3">
                      {archivedView ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: cor?.bg, color: cor?.text }}>{labelOf(MIDIA_SITUACAO_OPTIONS, r.situacao)}</span>
                      ) : (
                        <Select size="sm" value={r.situacao} onChange={v => changeSituacao(r.id, v)} options={MIDIA_SITUACAO_OPTIONS} />
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {gerarPedidos && r.situacao === 'aprovado' && (
                          <button onClick={() => gerarPPs(r)} disabled={isPending} title="Gerar Pedidos de Produção das opções escolhidas"
                            className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg border border-indigo-200 text-indigo-700 hover:bg-indigo-50 transition disabled:opacity-50">
                            <Factory className="w-3.5 h-3.5" /> Gerar PPs
                          </button>
                        )}
                        {showPrint && <Link href={`${base}/${r.id}/print`} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition" title="Imprimir / PDF"><Printer className="w-3.5 h-3.5" /></Link>}
                        <Link href={`${base}/${r.id}`} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition" title="Editar"><Pencil className="w-3.5 h-3.5" /></Link>
                        <button onClick={() => archive(r)} disabled={isPending} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition disabled:opacity-50" title={r.archived ? 'Desarquivar' : 'Arquivar'}>
                          {r.archived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
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
          <ClipboardList className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-gray-900 font-medium">{archivedView ? 'Nenhum registro arquivado' : 'Nenhum registro ainda'}</h3>
          <p className="text-gray-500 text-sm mt-1">{archivedView ? 'Arquivados aparecem aqui.' : 'Adicione o primeiro.'}</p>
        </div>
      )}
    </div>
  )
}
