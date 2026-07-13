'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  RefreshCw, Loader2, Check, X, RotateCcw, Landmark, ArrowDownCircle, ArrowUpCircle,
  Search, Sparkles, Scale, Plus, ChevronDown, Link2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { formatBRL, formatDateBR, parseMoney } from '@/lib/midia'
import {
  sincronizarBtg, conciliarMovimentoMulti, ignorarMovimento, desfazerConciliacaoBtg,
  criarLancamentoConc, type ConciliacaoItem,
} from '@/app/actions/btg'

export interface LancOption {
  id: string; tipo: string; contatoNome: string | null; descricao: string | null
  valor: number; saldo: number; vencimento: string | null
}
export interface ContaOpt { id: string; nome: string }
export interface MovementView {
  id: string; tipo: string; valor: number; dataMov: string
  descricao: string | null; categoria: string | null
  sugestao: { lancId: string; auto: boolean } | null
  itens: { nome: string; valor: number }[] | null
  status?: string
}

const round2 = (n: number) => Math.round(n * 100) / 100
const moneyStr = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const STATUS_LABEL: Record<string, string> = { conciliado: 'Conciliado', ignorado: 'Ignorado' }

export function ConciliacaoClient({
  orgSlug, pendentes, historico, abertos, contas, categoriasEntrada, categoriasSaida,
}: {
  orgSlug: string; pendentes: MovementView[]; historico: MovementView[]; abertos: LancOption[]
  contas: ContaOpt[]; categoriasEntrada: string[]; categoriasSaida: string[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [syncing, setSyncing] = useState(false)
  const [bulking, setBulking] = useState(false)
  const [showHistorico, setShowHistorico] = useState(false)

  const abertosPorTipo = useMemo(() => ({
    entrada: abertos.filter(l => l.tipo === 'entrada'),
    saida: abertos.filter(l => l.tipo === 'saida'),
  }), [abertos])

  const autoMovs = useMemo(() => pendentes.filter(m => m.sugestao?.auto), [pendentes])

  function runSync() {
    setSyncing(true)
    startTransition(async () => {
      const r = await sincronizarBtg(orgSlug)
      setSyncing(false)
      if (!r.ok) { toast.error(r.error); return }
      toast.success(`Sincronizado: ${r.movimentos} movimento(s) nos últimos 30 dias.`)
      router.refresh()
    })
  }

  async function conciliarSugeridos() {
    setBulking(true)
    let ok = 0
    for (const m of autoMovs) {
      if (!m.sugestao) continue
      const r = await conciliarMovimentoMulti(orgSlug, m.id, [{ lancamentoId: m.sugestao.lancId, valor: m.valor }])
      if (!r?.error) ok++
    }
    setBulking(false)
    if (ok) toast.success(`${ok} movimento(s) conciliado(s).`)
    else toast.error('Não foi possível conciliar os sugeridos.')
    router.refresh()
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 inline-flex items-center gap-2">
            <Landmark className="w-4 h-4 text-gray-400" /> Conciliação BTG
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Cruza o extrato do banco com os lançamentos em aberto — a soma tem que bater 100% com o movimento.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {autoMovs.length > 0 && (
            <button onClick={conciliarSugeridos} disabled={bulking || isPending}
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition">
              {bulking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Conciliar {autoMovs.length} sugerido{autoMovs.length > 1 ? 's' : ''}
            </button>
          )}
          <button onClick={runSync} disabled={syncing || isPending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Sincronizar agora
          </button>
        </div>
      </div>

      {pendentes.length === 0 ? (
        <div className="text-center py-24 bg-white rounded-xl border border-gray-200">
          <Check className="w-10 h-10 text-emerald-300 mx-auto mb-3" />
          <h3 className="text-gray-900 font-medium">Tudo conciliado</h3>
          <p className="text-gray-500 text-sm mt-1">Nenhum movimento pendente. Clique em <strong>Sincronizar agora</strong> pra buscar novos.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pendentes.map(m => (
            <PendingRow key={m.id} orgSlug={orgSlug} movement={m}
              candidatos={m.tipo === 'credit' ? abertosPorTipo.entrada : abertosPorTipo.saida}
              contas={contas}
              categorias={m.tipo === 'credit' ? categoriasEntrada : categoriasSaida} />
          ))}
        </div>
      )}

      {historico.length > 0 && (
        <div className="mt-6">
          <button onClick={() => setShowHistorico(s => !s)} className="text-sm text-gray-500 hover:text-gray-700 transition inline-flex items-center gap-1">
            <ChevronDown className={cn('w-4 h-4 transition-transform', showHistorico && 'rotate-180')} />
            {showHistorico ? 'Ocultar' : 'Ver'} histórico ({historico.length})
          </button>
          {showHistorico && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mt-3 divide-y divide-gray-50">
              {historico.map(m => <HistoryRow key={m.id} orgSlug={orgSlug} movement={m} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PendingRow({ orgSlug, movement, candidatos, contas, categorias }: {
  orgSlug: string; movement: MovementView; candidatos: LancOption[]; contas: ContaOpt[]; categorias: string[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const credito = movement.tipo === 'credit'
  const auto = !!movement.sugestao?.auto

  const [extras, setExtras] = useState<LancOption[]>([])
  const all = useMemo(() => [...extras, ...candidatos], [extras, candidatos])

  // Seleção: lancId -> texto do valor aplicado (BR). Sugestão auto já vem marcada.
  const [sel, setSel] = useState<Record<string, string>>(() =>
    movement.sugestao ? { [movement.sugestao.lancId]: moneyStr(movement.valor) } : {})
  const [expanded, setExpanded] = useState(!auto)
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const selIds = Object.keys(sel)
  const sum = round2(selIds.reduce((a, id) => a + (parseMoney(sel[id]) || 0), 0))
  const diff = round2(movement.valor - sum)
  const exact = Math.abs(diff) < 0.005 && selIds.length > 0

  const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  const filtered = useMemo(() => {
    const q = norm(search)
    return all.filter(l => !q || norm(`${l.contatoNome ?? ''} ${l.descricao ?? ''}`).includes(q))
  }, [all, search])

  function toggle(l: LancOption) {
    setSel(prev => {
      const next = { ...prev }
      if (next[l.id] != null) { delete next[l.id]; return next }
      const curSum = round2(Object.keys(next).reduce((a, id) => a + (parseMoney(next[id]) || 0), 0))
      const remaining = round2(movement.valor - curSum)
      const amount = remaining > 0.005 ? Math.min(l.saldo, remaining) : l.saldo
      next[l.id] = moneyStr(round2(amount))
      return next
    })
  }
  function setAmount(id: string, txt: string) {
    setSel(prev => ({ ...prev, [id]: txt }))
  }

  function conciliar() {
    if (!exact) { toast.error('A soma dos lançamentos precisa bater com o valor do movimento.'); return }
    const itens: ConciliacaoItem[] = selIds
      .map(id => ({ lancamentoId: id, valor: parseMoney(sel[id]) || 0 }))
      .filter(i => i.valor > 0)
    startTransition(async () => {
      const r = await conciliarMovimentoMulti(orgSlug, movement.id, itens)
      if (r?.error) { toast.error(r.error); return }
      toast.success('Conciliado.')
      router.refresh()
    })
  }
  function ignorar() {
    startTransition(async () => {
      const r = await ignorarMovimento(orgSlug, movement.id)
      if (r?.error) { toast.error(r.error); return }
      toast.success('Movimento ignorado.')
      router.refresh()
    })
  }
  function onCreated(l: LancOption) {
    setExtras(prev => [l, ...prev])
    setShowCreate(false)
    setSel(prev => {
      const curSum = round2(Object.keys(prev).reduce((a, id) => a + (parseMoney(prev[id]) || 0), 0))
      const remaining = round2(movement.valor - curSum)
      const amount = remaining > 0.005 ? Math.min(l.saldo, remaining) : l.saldo
      return { ...prev, [l.id]: moneyStr(round2(amount)) }
    })
  }

  return (
    <div className={cn('bg-white rounded-xl border', auto ? 'border-emerald-200' : 'border-gray-200')}>
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
            credito ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600')}>
            {credito ? <ArrowDownCircle className="w-5 h-5" /> : <ArrowUpCircle className="w-5 h-5" />}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{movement.descricao || '—'}</p>
            <p className="text-xs text-gray-400">
              {formatDateBR(movement.dataMov)} · {credito ? 'crédito' : 'débito'}{movement.categoria ? ` · ${movement.categoria}` : ''}
            </p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={cn('text-sm font-semibold tabular-nums', credito ? 'text-emerald-600' : 'text-red-600')}>
            {credito ? '+' : '−'}{formatBRL(movement.valor)}
          </div>
          {auto
            ? <span className="inline-flex items-center gap-1 mt-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700"><Sparkles className="w-3 h-3" /> Sugerido</span>
            : <span className="inline-flex items-center gap-1 mt-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700"><Search className="w-3 h-3" /> Buscar</span>}
        </div>
      </div>

      <div className="px-4 pb-4">
        {expanded && (
          <>
            <div className="flex items-center gap-2 mb-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar lançamento por nome…"
                  className="w-full h-9 pl-9 pr-3 text-sm bg-gray-100 border border-transparent rounded-lg focus:bg-white focus:border-orange-300 focus:ring-2 focus:ring-orange-100 outline-none transition" />
              </div>
              <button onClick={() => setShowCreate(s => !s)}
                className="inline-flex items-center gap-1 h-9 px-3 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition shrink-0">
                <Plus className="w-4 h-4" /> Criar lançamento
              </button>
            </div>

            {showCreate && (
              <CreateForm orgSlug={orgSlug} tipo={credito ? 'entrada' : 'saida'} contas={contas} categorias={categorias}
                defaultValor={diff > 0.005 ? diff : movement.valor} defaultVenc={movement.dataMov}
                onCreated={onCreated} onCancel={() => setShowCreate(false)} />
            )}

            <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-100 divide-y divide-gray-50">
              {filtered.length === 0 ? (
                <p className="text-xs text-gray-400 px-3 py-4 text-center">Nenhum lançamento em aberto compatível. Use “Criar lançamento”.</p>
              ) : filtered.map(l => {
                const on = sel[l.id] != null
                return (
                  <div key={l.id} className={cn('flex items-center gap-2.5 px-3 py-2 transition-colors', on ? 'bg-orange-50/60' : 'hover:bg-gray-50')}>
                    <button onClick={() => toggle(l)} aria-label={on ? 'Remover' : 'Selecionar'}
                      className={cn('w-4 h-4 rounded border flex items-center justify-center shrink-0 transition',
                        on ? 'bg-orange-600 border-orange-600 text-[#fff]' : 'border-gray-300 hover:border-orange-400')}>
                      {on && <Check className="w-3 h-3" />}
                    </button>
                    <button onClick={() => toggle(l)} className="flex-1 min-w-0 text-left">
                      <p className="text-sm text-gray-800 truncate">{l.contatoNome || l.descricao || 'Sem descrição'}</p>
                      <p className="text-xs text-gray-400">
                        venc. {l.vencimento ? formatDateBR(l.vencimento) : '—'}
                        {l.saldo < l.valor && <span className="text-blue-500"> · saldo de {formatBRL(l.valor)}</span>}
                      </p>
                    </button>
                    {on ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-xs text-gray-400">R$</span>
                        <input value={sel[l.id]} onChange={e => setAmount(l.id, e.target.value)} inputMode="decimal"
                          className="w-24 h-8 px-2 text-sm text-right tabular-nums bg-white border border-gray-200 rounded-lg focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none" />
                      </div>
                    ) : (
                      <span className="text-sm text-gray-500 tabular-nums shrink-0">{formatBRL(l.saldo)}</span>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        <div className={cn('flex items-center justify-between gap-3 mt-3 px-3 py-2.5 rounded-lg',
          exact ? 'bg-emerald-50' : selIds.length ? 'bg-amber-50' : 'bg-gray-50')}>
          <div className="flex items-center gap-2 text-sm min-w-0">
            <Scale className={cn('w-4 h-4 shrink-0', exact ? 'text-emerald-600' : 'text-gray-400')} />
            {selIds.length === 0 ? (
              <span className="text-gray-500">Selecione os lançamentos que somam {formatBRL(movement.valor)}</span>
            ) : exact ? (
              <span className="text-emerald-700 font-medium">Bate 100% — {formatBRL(sum)} de {formatBRL(movement.valor)}</span>
            ) : (
              <span className="text-amber-700">
                {formatBRL(sum)} de {formatBRL(movement.valor)} — {diff > 0 ? `faltam ${formatBRL(diff)}` : `excede ${formatBRL(-diff)}`}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {!expanded && (
              <button onClick={() => setExpanded(true)} className="px-2.5 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-white transition">
                Buscar outro
              </button>
            )}
            <button onClick={ignorar} disabled={isPending}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-500 hover:bg-white disabled:opacity-40 transition">
              <X className="w-3.5 h-3.5" /> Ignorar
            </button>
            <button onClick={conciliar} disabled={isPending || !exact}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-[#fff] hover:bg-emerald-700 disabled:opacity-40 transition">
              {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Conciliar{selIds.length > 1 ? ` ${selIds.length}` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CreateForm({ orgSlug, tipo, contas, categorias, defaultValor, defaultVenc, onCreated, onCancel }: {
  orgSlug: string; tipo: 'entrada' | 'saida'; contas: ContaOpt[]; categorias: string[]
  defaultValor: number; defaultVenc: string; onCreated: (l: LancOption) => void; onCancel: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [contato, setContato] = useState('')
  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState(moneyStr(round2(defaultValor)))
  const [vencimento, setVencimento] = useState(defaultVenc)
  const [contaId, setContaId] = useState('')
  const [categoria, setCategoria] = useState('')

  const contaOpts = [{ value: '', label: 'Conta —' }, ...contas.map(c => ({ value: c.id, label: c.nome }))]
  const catOpts = [{ value: '', label: 'Categoria —' }, ...categorias.map(c => ({ value: c, label: c }))]

  function salvar() {
    const v = parseMoney(valor)
    if (!contato.trim() && !descricao.trim()) { toast.error('Informe o contato ou a descrição.'); return }
    if (!(v > 0)) { toast.error('Informe um valor válido.'); return }
    startTransition(async () => {
      const r = await criarLancamentoConc(orgSlug, {
        tipo,
        contato_tipo: contato.trim() ? (tipo === 'entrada' ? 'cliente' : 'fornecedor') : null,
        contato_nome: contato.trim() || null,
        descricao: descricao.trim() || null,
        valor: String(v),
        vencimento: vencimento || null,
        conta_id: contaId || null,
        categoria: categoria || null,
      })
      if (r?.error || !r?.id) { toast.error(r?.error || 'Falha ao criar lançamento.'); return }
      onCreated({
        id: r.id, tipo, contatoNome: contato.trim() || null, descricao: descricao.trim() || null,
        valor: v, saldo: v, vencimento: vencimento || null,
      })
      toast.success('Lançamento criado e selecionado.')
    })
  }

  return (
    <div className="mb-2 p-3 rounded-lg border border-orange-200 bg-orange-50/40 space-y-2">
      <p className="text-xs font-medium text-gray-600">Novo lançamento a {tipo === 'entrada' ? 'receber' : 'pagar'}</p>
      <div className="grid grid-cols-2 gap-2">
        <input value={contato} onChange={e => setContato(e.target.value)} placeholder={tipo === 'entrada' ? 'Cliente' : 'Fornecedor'}
          className="h-9 px-3 text-sm bg-white border border-gray-200 rounded-lg focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none" />
        <input value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Descrição"
          className="h-9 px-3 text-sm bg-white border border-gray-200 rounded-lg focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none" />
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-400">R$</span>
          <input value={valor} onChange={e => setValor(e.target.value)} inputMode="decimal"
            className="flex-1 h-9 px-2 text-sm text-right tabular-nums bg-white border border-gray-200 rounded-lg focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none" />
        </div>
        <input type="date" value={vencimento} onChange={e => setVencimento(e.target.value)}
          className="h-9 px-3 text-sm bg-white border border-gray-200 rounded-lg focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none" />
        <Select size="sm" value={contaId} onChange={setContaId} options={contaOpts} placeholder="Conta —" />
        <Select size="sm" value={categoria} onChange={setCategoria} options={catOpts} placeholder="Categoria —" />
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <button onClick={onCancel} disabled={isPending} className="px-2.5 py-1.5 text-xs text-gray-500 hover:text-gray-700 transition">Cancelar</button>
        <button onClick={salvar} disabled={isPending}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-orange-600 text-[#fff] hover:bg-orange-700 disabled:opacity-40 transition">
          {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Criar e selecionar
        </button>
      </div>
    </div>
  )
}

function HistoryRow({ orgSlug, movement }: { orgSlug: string; movement: MovementView }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const credito = movement.tipo === 'credit'
  function desfazer() {
    startTransition(async () => {
      const r = await desfazerConciliacaoBtg(orgSlug, movement.id)
      if (r?.error) { toast.error(r.error); return }
      toast.success('Desfeito — voltou pra pendente.')
      router.refresh()
    })
  }
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="text-xs text-gray-400 tabular-nums w-20 shrink-0">{formatDateBR(movement.dataMov)}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-700 truncate">{movement.descricao || '—'}</p>
        {movement.itens && movement.itens.length > 0 && (
          <p className="text-xs text-gray-400 truncate inline-flex items-center gap-1">
            <Link2 className="w-3 h-3" /> {movement.itens.map(i => i.nome).join(', ')}
          </p>
        )}
      </div>
      <span className={cn('text-sm tabular-nums shrink-0', credito ? 'text-emerald-600' : 'text-red-600')}>
        {credito ? '+' : '−'}{formatBRL(movement.valor)}
      </span>
      <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full shrink-0',
        movement.status === 'conciliado' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500')}>
        {STATUS_LABEL[movement.status ?? ''] ?? movement.status}
      </span>
      <button onClick={desfazer} disabled={isPending}
        className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-orange-600 transition disabled:opacity-40 shrink-0">
        <RotateCcw className="w-3.5 h-3.5" /> Desfazer
      </button>
    </div>
  )
}
