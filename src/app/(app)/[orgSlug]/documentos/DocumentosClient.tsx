'use client'

import { Fragment, useMemo, useState } from 'react'
import { Search, FileText, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBRL, formatDateBR } from '@/lib/midia'
import { SERIE_LABELS } from '@/lib/doc-series'

export interface DocHistLinha {
  serie: string; numero: number; documento: string
  emissao: string | null; vencimento: string | null
  contato: string | null; descricao: string | null; cliente: string | null; valor: number
}

interface DocAgrupado {
  documento: string; serie: string; numero: number
  cliente: string; descricao: string; total: number
  emissao: string | null; linhas: DocHistLinha[]
}

export function DocumentosClient({ linhas }: { linhas: DocHistLinha[] }) {
  const [q, setQ] = useState('')
  const [serie, setSerie] = useState<string | null>(null)
  const [aberto, setAberto] = useState<string | null>(null)

  // Agrupa por documento (as linhas são parcelas/lançamentos do mesmo número).
  const docs = useMemo<DocAgrupado[]>(() => {
    const m = new Map<string, DocAgrupado>()
    for (const l of linhas) {
      const g = m.get(l.documento) ?? {
        documento: l.documento, serie: l.serie, numero: l.numero,
        cliente: l.cliente ?? '—', descricao: l.descricao ?? '', total: 0,
        emissao: l.emissao, linhas: [],
      }
      g.total += l.valor
      g.linhas.push(l)
      if (!g.descricao && l.descricao) g.descricao = l.descricao
      m.set(l.documento, g)
    }
    return [...m.values()]
  }, [linhas])

  const series = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of docs) m.set(d.serie, (m.get(d.serie) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [docs])

  const filtrados = useMemo(() => {
    const termo = q.trim().toLowerCase()
    return docs
      .filter(d => (serie ? d.serie === serie : true))
      .filter(d => !termo || `${d.documento} ${d.cliente} ${d.descricao}`.toLowerCase().includes(termo))
      .sort((a, b) => a.serie === b.serie ? b.numero - a.numero : a.serie.localeCompare(b.serie))
  }, [docs, q, serie])

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-gray-900">Histórico de documentos</h1>
        <p className="text-gray-500 text-sm mt-0.5">Documentos gerados no Siga (último ano). Busque por número, cliente ou descrição.</p>
      </div>

      <div className="relative mb-3">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          autoFocus value={q} onChange={e => setQ(e.target.value)}
          placeholder="Ex.: PP 1673, MX, Construtora SF…"
          className="w-full pl-9 pr-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
        />
      </div>

      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        <Chip label="Todas" active={serie === null} onClick={() => setSerie(null)} count={docs.length} />
        {series.map(([s, n]) => (
          <Chip key={s} label={s} title={SERIE_LABELS[s]} count={n} active={serie === s} onClick={() => setSerie(serie === s ? null : s)} />
        ))}
      </div>

      {filtrados.length > 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                <th className="text-left px-4 py-2 w-24">Documento</th>
                <th className="text-left px-4 py-2">Cliente</th>
                <th className="text-left px-4 py-2">Descrição</th>
                <th className="text-right px-4 py-2 w-32">Valor</th>
                <th className="text-left px-4 py-2 w-24">Emissão</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(d => {
                const multi = d.linhas.length > 1
                const open = aberto === d.documento
                return (
                  <Fragment key={d.documento}>
                    <tr
                      className={cn('border-b border-gray-50 transition-colors', multi && 'cursor-pointer hover:bg-orange-50/30')}
                      onClick={() => multi && setAberto(open ? null : d.documento)}
                    >
                      <td className="px-4 py-2 text-sm font-medium text-gray-900 tabular-nums whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          {multi && <ChevronRight className={cn('w-3.5 h-3.5 text-gray-400 transition-transform', open && 'rotate-90')} />}
                          {d.documento}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-700">{d.cliente}</td>
                      <td className="px-4 py-2 text-sm text-gray-500 max-w-[280px] truncate" title={d.descricao}>{d.descricao || '—'}</td>
                      <td className="px-4 py-2 text-sm text-gray-900 text-right font-medium tabular-nums">
                        {formatBRL(d.total)}{multi && <span className="text-[11px] text-gray-400 ml-1">({d.linhas.length}x)</span>}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-500 tabular-nums">{formatDateBR(d.emissao ?? undefined)}</td>
                    </tr>
                    {multi && open && d.linhas.map((l, i) => (
                      <tr key={i} className="bg-gray-50/40 border-b border-gray-50 text-xs">
                        <td className="px-4 py-1.5" />
                        <td className="px-4 py-1.5 text-gray-500">{l.contato ?? ''}</td>
                        <td className="px-4 py-1.5 text-gray-500 truncate max-w-[280px]" title={l.descricao ?? ''}>{l.descricao}</td>
                        <td className="px-4 py-1.5 text-right text-gray-700 tabular-nums">{formatBRL(l.valor)}</td>
                        <td className="px-4 py-1.5 text-gray-500 tabular-nums">venc. {formatDateBR(l.vencimento ?? undefined)}</td>
                      </tr>
                    ))}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-20 bg-white rounded-xl border border-gray-200">
          <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-gray-900 font-medium">Nenhum documento encontrado</h3>
          <p className="text-gray-500 text-sm mt-1">Ajuste a busca ou o filtro de série.</p>
        </div>
      )}
    </div>
  )
}

function Chip({ label, count, active, onClick, title }: { label: string; count?: number; active: boolean; onClick: () => void; title?: string }) {
  return (
    <button onClick={onClick} title={title}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors active:scale-[0.97]',
        active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300',
      )}>
      {label}
      {count != null && <span className={cn('text-[10px] font-semibold', active ? 'text-white/70' : 'text-gray-400')}>{count}</span>}
    </button>
  )
}
