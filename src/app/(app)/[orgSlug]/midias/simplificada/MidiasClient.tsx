'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Archive, ArchiveRestore, Megaphone, Pencil, Download, Copy, Search, X, Bookmark } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Select, MultiSelect } from '@/components/ui/Select'
import { DatePicker } from '@/components/ui/DatePicker'
import { setMidiaSituacao, setMidiaArchived, duplicarMidia } from '@/app/actions/midia'
import { setViewPrefs } from '@/app/actions/prefs'
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
/**
 * O filtro que volta ao abrir a tela e o que se salva com nome. A busca fica de
 * fora: é de momento ("cadê a 2604?"), não um recorte que se repete.
 */
interface Filtro { clientes: string[]; veiculos: string[]; situacoes: string[]; de: string; ate: string }
interface FiltroSalvo extends Filtro { id: string; nome: string }
export interface PrefsLiberacao { ultimo?: Partial<Filtro>; salvos?: FiltroSalvo[] }
const VAZIO: Filtro = { clientes: [], veiculos: [], situacoes: [], de: '', ate: '' }
const lerFiltro = (f?: Partial<Filtro> | null): Filtro => ({
  clientes: Array.isArray(f?.clientes) ? f.clientes : [],
  veiculos: Array.isArray(f?.veiculos) ? f.veiculos : [],
  situacoes: Array.isArray(f?.situacoes) ? f.situacoes : [],
  de: typeof f?.de === 'string' ? f.de : '',
  ate: typeof f?.ate === 'string' ? f.ate : '',
})
const chaveDe = (f: Filtro) => JSON.stringify([[...f.clientes].sort(), [...f.veiculos].sort(), [...f.situacoes].sort(), f.de, f.ate])

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
  prefs,
  prefsView,
}: {
  orgSlug: string; midias: MidiaRow[]; archivedView: boolean
  basePath?: string; title?: string; subtitle?: string; addLabel?: string
  /** Vários botões de "Adicionar" (ex.: Jornal/Revista). Se ausente, usa addLabel → base/nova. */
  addOptions?: { label: string; href: string }[]
  /** Link de edição por linha (ex.: Jornal vai pra rota diferente). Default base/id. */
  editHrefFor?: (m: MidiaRow) => string
  /** Último filtro + filtros salvos da pessoa (user_view_prefs), lidos no servidor. */
  prefs?: Record<string, unknown> | null
  /** Chave da tela em user_view_prefs — uma por tipo de liberação. */
  prefsView?: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const base = `/${orgSlug}/${basePath}`
  const editHref = (m: MidiaRow) => (editHrefFor ? editHrefFor(m) : `${base}/${m.id}`)

  // Busca + filtros + período para ACHAR uma liberação (Rafael, 27/10). Tudo no
  // navegador: são dezenas de linhas por tela (medido: 50 na maior), não milhares.
  // O filtro da última visita volta (no banco, segue a pessoa entre máquinas).
  const inicial = prefs as PrefsLiberacao | null | undefined
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>(() => lerFiltro(inicial?.ultimo))
  const [salvos, setSalvos] = useState<FiltroSalvo[]>(() =>
    (Array.isArray(inicial?.salvos) ? inicial.salvos : []).map(f => ({ ...lerFiltro(f), id: f.id, nome: f.nome })))
  const { clientes, veiculos, situacoes, de, ate } = filtro
  const muda = (p: Partial<Filtro>) => setFiltro(f => ({ ...f, ...p }))

  // Grava com folga de 600 ms: marcar três clientes seguidos vira uma escrita só.
  const gravado = useRef(JSON.stringify({ ultimo: filtro, salvos }))
  useEffect(() => {
    if (!prefsView) return
    const corpo = JSON.stringify({ ultimo: filtro, salvos })
    if (corpo === gravado.current) return
    const t = setTimeout(() => {
      gravado.current = corpo
      setViewPrefs(orgSlug, prefsView, { ultimo: filtro, salvos }).catch(() => {})
    }, 600)
    return () => clearTimeout(t)
  }, [filtro, salvos, orgSlug, prefsView])
  const opCliente = useMemo(() => opcoesDe(midias.map(m => m.cliente)), [midias])
  const opVeiculo = useMemo(() => opcoesDe(midias.map(m => m.veiculo)), [midias])
  const opSituacao = useMemo(() => {
    const tem = new Set(midias.map(m => m.situacao))
    return MIDIA_SITUACAO_OPTIONS.filter(o => tem.has(o.value))
  }, [midias])

  const temFiltro = chaveDe(filtro) !== chaveDe(VAZIO)
  const filtrando = !!busca.trim() || temFiltro
  const ativo = salvos.find(f => chaveDe(f) === chaveDe(filtro))
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

  function limpar() { setBusca(''); setFiltro(VAZIO) }

  function salvarFiltro(nome: string) {
    setSalvos(l => [...l, { ...filtro, id: crypto.randomUUID(), nome }])
    toast.success(`Filtro "${nome}" salvo.`)
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
          <MultiSelect size="sm" values={clientes} onChange={v => muda({ clientes: v })} options={opCliente} allLabel="Todos os clientes" />
          <MultiSelect size="sm" values={veiculos} onChange={v => muda({ veiculos: v })} options={opVeiculo} allLabel="Todos os veículos" />
          <MultiSelect size="sm" values={situacoes} onChange={v => muda({ situacoes: v })} options={opSituacao} allLabel="Todas as situações" />
          <DatePicker startDate={de} endDate={ate} onStartChange={v => muda({ de: v })} onEndChange={v => muda({ ate: v })} placeholder="Período de veiculação" />
          {prefsView && temFiltro && !ativo && <SalvarFiltro onSalvar={salvarFiltro} />}
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

      {/* Filtros salvos: um clique aplica; o aceso é o que está valendo agora. */}
      {midias.length > 0 && salvos.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5" aria-label="Filtros salvos">
          <span className="text-[11px] font-medium text-gray-400 mr-0.5">Salvos</span>
          {salvos.map(f => (
            <span key={f.id}
              className={cn('inline-flex items-center gap-0.5 rounded-full border pl-3 pr-1 py-0.5 text-xs transition-colors',
                ativo?.id === f.id ? 'border-orange-300 bg-orange-50 text-orange-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50')}>
              <button type="button" onClick={() => setFiltro(ativo?.id === f.id ? VAZIO : lerFiltro(f))}
                aria-pressed={ativo?.id === f.id} className="max-w-[12rem] truncate py-0.5" title={f.nome}>
                {f.nome}
              </button>
              <button type="button" onClick={() => setSalvos(l => l.filter(x => x.id !== f.id))}
                title={`Excluir o filtro "${f.nome}"`} aria-label={`Excluir o filtro ${f.nome}`}
                className="p-0.5 rounded-full text-gray-300 hover:text-red-500 hover:bg-white transition-colors">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
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

/** "Salvar filtro": pede só o nome. Enter salva, Esc ou clique fora fecha. */
function SalvarFiltro({ onSalvar }: { onSalvar: (nome: string) => void }) {
  const [aberto, setAberto] = useState(false)
  const [nome, setNome] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false) }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [aberto])

  function salvar() {
    const n = nome.trim()
    if (!n) return
    onSalvar(n); setNome(''); setAberto(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setAberto(a => !a)} aria-expanded={aberto}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors active:scale-[0.97]">
        <Bookmark className="w-3.5 h-3.5" aria-hidden /> Salvar filtro
      </button>
      {aberto && (
        <div className="pop-in absolute left-0 top-full mt-1.5 z-50 w-60 bg-white rounded-xl border border-gray-200 shadow-lg p-2">
          <input autoFocus value={nome} onChange={e => setNome(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') salvar(); if (e.key === 'Escape') setAberto(false) }}
            placeholder="Nome (ex.: Outdoor KSBIG setembro)"
            className="w-full px-2.5 py-1.5 bg-gray-100 border border-transparent rounded-xl text-sm focus:bg-white focus:border-orange-300 focus:outline-none transition-colors" />
          <div className="flex justify-end gap-2 mt-2">
            <button type="button" onClick={() => setAberto(false)}
              className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1">Cancelar</button>
            <button type="button" onClick={salvar} disabled={!nome.trim()}
              className="text-xs font-medium px-3 py-1 rounded-lg bg-orange-600 text-[#fff] hover:bg-orange-700 disabled:opacity-50 transition-colors">
              Salvar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
