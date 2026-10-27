'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Archive, ArchiveRestore, Megaphone, Pencil, Download, Copy, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Select, MultiSelect } from '@/components/ui/Select'
import { DatePicker } from '@/components/ui/DatePicker'
import { setMidiaSituacao, setMidiaArchived, duplicarMidia } from '@/app/actions/midia'
import {
  MIDIA_TIPO_OPTIONS, MIDIA_SITUACAO_OPTIONS, MIDIA_SITUACAO_COLORS, labelOf, formatBRL,
} from '@/lib/midia'
import { docNumero } from '@/lib/doc-series'

export interface MidiaRow {
  id: string; numero: number | null; serie?: string | null; titulo: string; tipo: string | null
  valor: number; desconto_pct: number; faturamento: string | null
  situacao: string; archived: boolean; cliente: string; veiculo: string
  /** Produção embutida (só a Externa tem): entra no Valor e na Comissão. */
  producao?: { total: number; comissao: number }
  /** Primeira e última veiculação (YYYY-MM-DD) — base do filtro de período. */
  inicio?: string | null; fim?: string | null
}

/** Sem acento e minúsculo: "Revista Dife" acha com "dife", "Cascavel" com "cascável". */
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
const ddmm = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '')
const valorDe = (m: MidiaRow) => m.valor + (m.producao?.total ?? 0)
const comissaoDe = (m: MidiaRow) => m.valor * (m.desconto_pct / 100) + (m.producao?.comissao ?? 0)
const opcoesDe = (lista: string[]) =>
  [...new Set(lista.filter(v => v && v !== '—'))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .map(v => ({ value: v, label: v }))

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

  // Busca + filtros + período para ACHAR uma liberação (Rafael, 27/10). Tudo no
  // navegador: são dezenas de linhas por tela (medido: 50 na maior), não milhares.
  const [busca, setBusca] = useState('')
  const [clientes, setClientes] = useState<string[]>([])
  const [veiculos, setVeiculos] = useState<string[]>([])
  const [situacoes, setSituacoes] = useState<string[]>([])
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const opCliente = useMemo(() => opcoesDe(midias.map(m => m.cliente)), [midias])
  const opVeiculo = useMemo(() => opcoesDe(midias.map(m => m.veiculo)), [midias])
  const opSituacao = useMemo(() => {
    const tem = new Set(midias.map(m => m.situacao))
    return MIDIA_SITUACAO_OPTIONS.filter(o => tem.has(o.value))
  }, [midias])

  const filtrando = !!busca.trim() || clientes.length > 0 || veiculos.length > 0 || situacoes.length > 0 || !!de || !!ate
  const lista = useMemo(() => {
    const q = norm(busca.trim())
    return midias.filter(m => {
      if (clientes.length && !clientes.includes(m.cliente)) return false
      if (veiculos.length && !veiculos.includes(m.veiculo)) return false
      if (situacoes.length && !situacoes.includes(m.situacao)) return false
      // Período = veicula em algum dia do intervalo (sobreposição), não "começa
      // dentro": o outdoor de 01/09 a 30/09 aparece quando se procura 15/09.
      if (ate && m.inicio && m.inicio > ate) return false
      if (de && m.fim && m.fim < de) return false
      if (q && !norm(`${docNumero(m.serie, m.numero)} ${m.titulo} ${m.cliente} ${m.veiculo}`).includes(q)) return false
      return true
    })
  }, [midias, busca, clientes, veiculos, situacoes, de, ate])

  function limpar() {
    setBusca(''); setClientes([]); setVeiculos([]); setSituacoes([]); setDe(''); setAte('')
  }

  function changeSituacao(id: string, situacao: string) {
    startTransition(async () => { await setMidiaSituacao(orgSlug, id, situacao); router.refresh() })
  }
  function archive(m: MidiaRow) {
    startTransition(async () => { await setMidiaArchived(orgSlug, m.id, !m.archived); router.refresh() })
  }
  /** Duplicar abre a cópia já em edição: quase sempre muda a bisemana em seguida. */
  function duplicar(m: MidiaRow) {
    startTransition(async () => {
      const r = await duplicarMidia(orgSlug, m.id)
      if (r?.error || !r?.id) { toast.error(r?.error || 'Não foi possível duplicar.'); return }
      toast.success('Cópia criada em aberto.')
      router.push(editHrefFor ? editHrefFor({ ...m, id: r.id }) : `${base}/${r.id}`)
    })
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
                className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 transition">
                <Plus className="w-4 h-4" /> {opt.label}
              </Link>
            ))
          ) : (
            <Link href={`${base}/nova`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 transition">
              <Plus className="w-4 h-4" /> {addLabel}
            </Link>
          ))}
        </div>
      </div>

      {midias.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="relative flex-1 min-w-[14rem] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" aria-hidden />
            <span className="sr-only">Buscar</span>
            <input type="search" value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por nº, título, cliente ou veículo"
              className="w-full pl-9 pr-3 py-2 text-sm bg-gray-100 border border-transparent rounded-xl text-gray-800 placeholder:text-gray-400 focus:bg-white focus:border-orange-300 focus:outline-none transition-colors" />
          </label>
          <MultiSelect size="sm" values={clientes} onChange={setClientes} options={opCliente} allLabel="Todos os clientes" />
          <MultiSelect size="sm" values={veiculos} onChange={setVeiculos} options={opVeiculo} allLabel="Todos os veículos" />
          <MultiSelect size="sm" values={situacoes} onChange={setSituacoes} options={opSituacao} allLabel="Todas as situações" />
          <DatePicker startDate={de} endDate={ate} onStartChange={setDe} onEndChange={setAte} placeholder="Período de veiculação" />
          {filtrando && (
            <button type="button" onClick={limpar}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors active:scale-[0.97]">
              <X className="w-3.5 h-3.5" aria-hidden /> Limpar
            </button>
          )}
          {filtrando && (
            <span className="ml-auto text-xs text-gray-500 tabular-nums">{lista.length} de {midias.length}</span>
          )}
        </div>
      )}

      {midias.length > 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50 text-xs font-medium text-gray-400">
                <th className="text-left px-4 py-3 w-14">Nº</th>
                <th className="text-left px-4 py-3">Título</th>
                <th className="text-left px-4 py-3">Cliente</th>
                <th className="text-left px-4 py-3">Veículo</th>
                <th className="text-left px-4 py-3">Veiculação</th>
                <th className="text-left px-4 py-3">Tipo</th>
                <th className="text-right px-4 py-3">Valor</th>
                <th className="text-right px-4 py-3">Comissão</th>
                <th className="text-left px-4 py-3 w-44">Situação</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {lista.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-sm text-gray-500">
                    Nenhuma liberação com esses filtros.{' '}
                    <button type="button" onClick={limpar} className="font-medium text-orange-600 hover:text-orange-700">Limpar filtros</button>
                  </td>
                </tr>
              )}
              {lista.map(m => {
                const prod = m.producao ?? { total: 0, comissao: 0 }
                const valor = valorDe(m)
                const comissao = comissaoDe(m)
                const cor = MIDIA_SITUACAO_COLORS[m.situacao]
                return (
                  <tr key={m.id} className="hover:bg-gray-50/50 transition">
                    <td className="px-4 py-3 text-sm text-gray-400 whitespace-nowrap tabular-nums">{docNumero(m.serie, m.numero)}</td>
                    <td className="px-4 py-3 text-sm font-medium">
                      <Link href={editHref(m)} className="text-gray-900 hover:text-orange-600 transition">
                        {m.titulo}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{m.cliente}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{m.veiculo}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap tabular-nums">
                      {m.inicio ? `${ddmm(m.inicio)}${m.fim && m.fim !== m.inicio ? ` – ${ddmm(m.fim)}` : ''}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{labelOf(MIDIA_TIPO_OPTIONS, m.tipo)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 text-right tabular-nums">
                      {formatBRL(valor)}
                      {prod.total > 0 && m.valor > 0 && (
                        <span className="block text-[11px] text-gray-400">prod. {formatBRL(prod.total)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 text-right font-medium tabular-nums">
                      {formatBRL(comissao)}
                      {prod.comissao > 0 && m.valor > 0 && (
                        <span className="block text-[11px] font-normal text-gray-400">prod. {formatBRL(prod.comissao)}</span>
                      )}
                    </td>
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
                        {/* Baixa direto: a rota devolve o PDF com
                            Content-Disposition attachment. Sem aba, sem caixa. */}
                        <a href={`/api/docs/midia/${m.id}`} download
                          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition" title="Baixar PDF">
                          <Download className="w-3.5 h-3.5" />
                        </a>
                        <Link href={editHref(m)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition" title="Editar">
                          <Pencil className="w-3.5 h-3.5" />
                        </Link>
                        {!m.archived && (
                          <button onClick={() => duplicar(m)} disabled={isPending}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition disabled:opacity-50"
                            title="Duplicar (a cópia nasce em aberto)">
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        )}
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
            {/* Com filtro, o total responde "quanto deu outdoor de setembro". */}
            {filtrando && lista.length > 0 && (
              <tfoot>
                <tr className="border-t border-gray-200 bg-gray-50/50 text-sm">
                  <td colSpan={6} className="px-4 py-3 text-xs font-medium text-gray-500">
                    Total de {lista.length} {lista.length === 1 ? 'liberação' : 'liberações'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-600">{formatBRL(lista.reduce((t, m) => t + valorDe(m), 0))}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-gray-900">{formatBRL(lista.reduce((t, m) => t + comissaoDe(m), 0))}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
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
