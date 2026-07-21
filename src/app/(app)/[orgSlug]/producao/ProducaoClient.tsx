'use client'

import { Fragment, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Archive, ArchiveRestore, Pencil, ClipboardList, Printer, Factory, Files } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Select, type SelectOption } from '@/components/ui/Select'
import { setProducaoSituacao, setProducaoArchived, gerarPedidosDoOrcamento, gerarDocsDaProposta } from '@/app/actions/producao'
import { PRODUCAO_SITUACAO_OPTIONS, MIDIA_SITUACAO_COLORS, labelOf, formatBRL } from '@/lib/midia'
import { docNumero } from '@/lib/doc-series'

export interface ProducaoRow {
  id: string; numero: number | null; serie?: string | null; titulo: string; valor: number
  situacao: string; archived: boolean; cliente: string
  /** PPs geradas por este orçamento (migration 137) — vazio = ainda não gerou. */
  gerados?: { id: string; serie: string | null; numero: number | null }[]
}

export function ProducaoClient({
  orgSlug, items, archivedView, basePath, title, subtitle, addLabel, gerarPedidos = false, gerarDocs = false, showPrint = true,
  situacaoOptions = PRODUCAO_SITUACAO_OPTIONS,
}: {
  orgSlug: string; items: ProducaoRow[]; archivedView: boolean
  basePath: string; title: string; subtitle: string; addLabel: string
  /** Mostra "Gerar PPs" nos orçamentos aprovados. */
  gerarPedidos?: boolean
  /** Mostra "Gerar docs" nas propostas aprovadas. */
  gerarDocs?: boolean
  /** Mostra o botão de imprimir/PDF (false enquanto o tipo não tiver impressão). */
  showPrint?: boolean
  /** Estados disponíveis no seletor de situação (fee usa um conjunto reduzido). */
  situacaoOptions?: SelectOption[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [situacao, setSituacaoFiltro] = useState<string | null>(null)
  const base = `/${orgSlug}/${basePath}`

  const changeSituacao = (id: string, s: string) => startTransition(async () => { await setProducaoSituacao(orgSlug, id, s, basePath); router.refresh() })
  const archive = (r: ProducaoRow) => startTransition(async () => { await setProducaoArchived(orgSlug, r.id, !r.archived, basePath); router.refresh() })
  const gerarPPs = (r: ProducaoRow) => startTransition(async () => {
    const res = await gerarPedidosDoOrcamento(orgSlug, r.id)
    if (res?.error) toast.error(res.error)
    else { toast.success('Pedidos de Produção gerados.'); router.refresh() }
  })
  const gerarDocsFn = (r: ProducaoRow) => startTransition(async () => {
    const res = await gerarDocsDaProposta(orgSlug, r.id)
    if (res?.error) { toast.error(res.error); return }
    toast.success(`${res.count} documento(s) gerado(s) em rascunho${res.skipped ? ` (${res.skipped} serviço interno ignorado)` : ''}.`)
    router.refresh()
  })

  // Situações presentes (p/ os chips de filtro), com contagem.
  const situacoes = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of items) m.set(r.situacao, (m.get(r.situacao) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => (situacaoOptions.findIndex(o => o.value === a[0])) - (situacaoOptions.findIndex(o => o.value === b[0])))
  }, [items, situacaoOptions])

  // Filtra + agrupa por cliente (com total por cliente).
  const grupos = useMemo(() => {
    const filtered = situacao ? items.filter(r => r.situacao === situacao) : items
    const m = new Map<string, ProducaoRow[]>()
    for (const r of filtered) { const arr = m.get(r.cliente) ?? []; arr.push(r); m.set(r.cliente, arr) }
    return [...m.entries()]
      .map(([cliente, rows]) => ({ cliente, rows, total: rows.reduce((s, r) => s + r.valor, 0) }))
      .sort((a, b) => a.cliente.localeCompare(b.cliente))
  }, [items, situacao])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
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
            <Link href={`${base}/nova`} className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 transition">
              <Plus className="w-4 h-4" /> {addLabel}
            </Link>
          )}
        </div>
      </div>

      {/* Filtro por situação */}
      {situacoes.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          <Chip label="Todas" active={situacao === null} onClick={() => setSituacaoFiltro(null)} count={items.length} />
          {situacoes.map(([s, n]) => {
            const cor = MIDIA_SITUACAO_COLORS[s]
            return <Chip key={s} label={labelOf(situacaoOptions, s)} count={n} active={situacao === s} onClick={() => setSituacaoFiltro(situacao === s ? null : s)} dot={cor?.text} />
          })}
        </div>
      )}

      {grupos.length > 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                <th className="text-left px-4 py-2 w-20">Nº</th>
                <th className="text-left px-4 py-2">Título</th>
                <th className="text-right px-4 py-2 w-32">Valor</th>
                <th className="text-left px-4 py-2 w-40">Situação</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {grupos.map(g => (
                <Fragment key={g.cliente}>
                  <tr className="bg-gray-50/70 border-y border-gray-100">
                    <td colSpan={3} className="px-4 py-1.5">
                      <span className="text-xs font-semibold text-gray-700">{g.cliente}</span>
                      <span className="text-[11px] text-gray-400 ml-2">{g.rows.length} {g.rows.length === 1 ? 'item' : 'itens'}</span>
                    </td>
                    <td colSpan={2} className="px-4 py-1.5 text-right text-xs font-medium text-gray-500">{formatBRL(g.total)}</td>
                  </tr>
                  {g.rows.map(r => {
                    const cor = MIDIA_SITUACAO_COLORS[r.situacao]
                    return (
                      <tr key={r.id} className="border-b border-gray-50 hover:bg-orange-50/30 transition-colors">
                        <td className="px-4 py-1.5 text-sm text-gray-400 tabular-nums whitespace-nowrap">{docNumero(r.serie, r.numero)}</td>
                        <td className="px-4 py-1.5 text-sm font-medium"><Link href={`${base}/${r.id}`} className="text-gray-900 hover:text-orange-600 transition-colors">{r.titulo}</Link></td>
                        <td className="px-4 py-1.5 text-sm text-gray-900 text-right font-medium tabular-nums">{formatBRL(r.valor)}</td>
                        <td className="px-4 py-1.5">
                          {archivedView || !situacaoOptions.some(o => o.value === r.situacao) ? (
                            // Situação terminal (ex.: Fee 'faturado' pelo Financeiro) não é editável pelo dropdown.
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: cor?.bg, color: cor?.text }}>{labelOf(PRODUCAO_SITUACAO_OPTIONS, r.situacao)}</span>
                          ) : (
                            <Select size="sm" value={r.situacao} onChange={v => changeSituacao(r.id, v)} options={situacaoOptions} />
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center justify-end gap-1">
                            {/* Já gerou: o botão dá lugar aos PPs criados, com link.
                                É o que impede gerar duas vezes sem perceber — antes o
                                botão ficava lá pra sempre e cada clique duplicava. */}
                            {gerarPedidos && (r.gerados?.length ?? 0) > 0 && (
                              <span className="inline-flex items-center gap-1 mr-1">
                                {r.gerados!.map(pp => (
                                  <Link key={pp.id} href={`/${orgSlug}/producao/pedido/${pp.id}`}
                                    title="Abrir o Pedido de Produção gerado por este orçamento"
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums rounded-md border border-orange-100 bg-orange-50 text-orange-700 hover:bg-orange-100 transition-colors">
                                    {docNumero(pp.serie, pp.numero)}
                                  </Link>
                                ))}
                              </span>
                            )}
                            {gerarPedidos && r.situacao === 'aprovado' && (r.gerados?.length ?? 0) === 0 && (
                              <button onClick={() => gerarPPs(r)} disabled={isPending} title="Gerar Pedidos de Produção das opções escolhidas"
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border border-orange-200 text-orange-700 hover:bg-orange-50 transition-colors disabled:opacity-50 whitespace-nowrap">
                                <Factory className="w-3.5 h-3.5 shrink-0" /> Gerar PPs
                              </button>
                            )}
                            {gerarDocs && r.situacao === 'aprovado' && (
                              <button onClick={() => gerarDocsFn(r)} disabled={isPending} title="Gerar mídias/produções/fees em rascunho"
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border border-orange-200 text-orange-700 hover:bg-orange-50 transition-colors disabled:opacity-50 whitespace-nowrap">
                                <Files className="w-3.5 h-3.5 shrink-0" /> Gerar docs
                              </button>
                            )}
                            {showPrint && <Link href={`${base}/${r.id}/print`} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="Imprimir / PDF"><Printer className="w-3.5 h-3.5" /></Link>}
                            <Link href={`${base}/${r.id}`} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="Editar"><Pencil className="w-3.5 h-3.5" /></Link>
                            <button onClick={() => archive(r)} disabled={isPending} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50" title={r.archived ? 'Desarquivar' : 'Arquivar'}>
                              {r.archived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-24 bg-white rounded-xl border border-gray-200">
          <ClipboardList className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-gray-900 font-medium">{situacao ? 'Nada nesta situação' : archivedView ? 'Nenhum registro arquivado' : 'Nenhum registro ainda'}</h3>
          <p className="text-gray-500 text-sm mt-1">{situacao ? 'Ajuste o filtro acima.' : archivedView ? 'Arquivados aparecem aqui.' : 'Adicione o primeiro.'}</p>
        </div>
      )}
    </div>
  )
}

function Chip({ label, count, active, onClick, dot }: { label: string; count?: number; active: boolean; onClick: () => void; dot?: string }) {
  return (
    <button onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors active:scale-[0.97]',
        active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300',
      )}>
      {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: dot }} />}
      {label}
      {count != null && <span className={cn('text-[10px] font-semibold', active ? 'text-white/70' : 'text-gray-400')}>{count}</span>}
    </button>
  )
}
