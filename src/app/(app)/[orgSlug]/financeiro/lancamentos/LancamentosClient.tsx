'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, FileText, Receipt, Check, RotateCcw, AlertTriangle, RefreshCw, Plus, X, Loader2, Pencil, Trash2, ArrowDownCircle, ArrowUpCircle, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBRL, formatDateBR } from '@/lib/midia'
import { Select } from '@/components/ui/Select'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { DocChip } from '@/components/ui/DocChip'
import { docNumero } from '@/lib/doc-series'
import { toast } from 'sonner'
import {
  setLancamentoFlags, ressincronizarLancamento, marcarLancamentoRevisado,
  createLancamento, createLancamentosSerie, updateLancamento, deleteLancamento, liquidarLancamento, reabrirLancamento,
  setLancamentoAnexos, promoverExtrato, updateLancamentosLote, descartarExtrato,
  impactoExcluirLancamento,
  type FinanceCategoriaGrupo, type FinanceCentro, type Anexo, type ImpactoExclusao,
} from '@/app/actions/financeiro'
import { categoriaNomes } from '@/lib/finance-categorias'
import { EMITENTES, EMITENTE_LABEL, chipDocumento, numeroDoNome, textoBuscavel } from '@/lib/documento-fiscal'
import { uploadFile } from '@/lib/storage/upload-client'
import { Paperclip, ExternalLink, CalendarClock } from 'lucide-react'

export interface Lancamento {
  id: string
  tipo: string                      // entrada | saida
  origem_tipo: string | null        // midia | producao | fee | manual
  parcela_num: number | null
  parcela_total: number | null
  contato_nome: string | null
  descricao: string | null
  valor: number | string
  valor_realizado: number | string | null
  vencimento: string | null
  competencia: string | null
  situacao: string                  // em_aberto | recebido | pago
  nf_emitida: boolean
  boleto_gerado: boolean
  revisar: boolean
  conta_id: string | null
  categoria: string | null
  centro_custo: string | null
  data_liquidacao: string | null
  forma_pagamento: string | null
  observacao: string | null
  juros: number | string | null
  multa: number | string | null
  desconto: number | string | null
  tarifa: number | string | null
  anexos: Anexo[] | null
  origem_ref?: string | null        // (promovido do extrato) import_ref que este lançamento "assume"
  // Documento que originou a cobrança (view lancamentos_doc, migration 135).
  origem_id?: string | null
  doc_serie?: string | null
  doc_numero?: number | null
  doc_origem?: string | null        // producao | midia
  doc_producao_tipo?: string | null // fee | pedido | proposta | orcamento
  source?: 'flow' | 'importado'     // 'importado' = linha do extrato Conta Azul (read-only até promover)
  import_ref?: string | null        // (source=importado) chave estável no extrato
}

export interface ContaRef { id: string; nome: string; cor: string | null; ativo: boolean }

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

// Período da tela: mês, ano ou intervalo personalizado. A lista mostra SÓ o que cai no período.
type Periodo =
  | { tipo: 'mes'; ano: number; mes: number }
  | { tipo: 'ano'; ano: number }
  | { tipo: 'custom'; start: string; end: string }

function lastDay(ano: number, mes: number) { return new Date(Date.UTC(ano, mes, 0)).getUTCDate() }
function periodoRange(p: Periodo): { start: string; end: string } {
  if (p.tipo === 'ano') return { start: `${p.ano}-01-01`, end: `${p.ano}-12-31` }
  if (p.tipo === 'custom') return { start: p.start, end: p.end }
  const mm = String(p.mes).padStart(2, '0')
  const dd = String(lastDay(p.ano, p.mes)).padStart(2, '0')
  return { start: `${p.ano}-${mm}-01`, end: `${p.ano}-${mm}-${dd}` }
}
function periodoLabel(p: Periodo): string {
  if (p.tipo === 'ano') return String(p.ano)
  if (p.tipo === 'custom') return `${formatDateBR(p.start)} – ${formatDateBR(p.end)}`
  return `${MESES[p.mes - 1]} ${p.ano}`
}
function shiftPeriodo(p: Periodo, delta: number): Periodo {
  if (p.tipo === 'ano') return { tipo: 'ano', ano: p.ano + delta }
  if (p.tipo === 'custom') return p
  const d = new Date(Date.UTC(p.ano, p.mes - 1 + delta, 1))
  return { tipo: 'mes', ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 }
}
const isPago = (s: string) => s === 'pago' || s === 'recebido'
const val = (l: Lancamento) => Number(l.valor ?? 0)
const realVal = (l: Lancamento) => Number(l.valor_realizado ?? l.valor ?? 0)
/** "1.234,56" → "1234.56" (string p/ a RPC). Vazio → '0'. */
const parseBR = (s: string) => { const t = s.trim().replace(/\./g, '').replace(',', '.'); return t === '' ? '0' : t }
const inputCls = 'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

export function LancamentosClient({ orgSlug, lancamentos, importadas = [], contas, categorias, centros, today }: {
  orgSlug: string; lancamentos: Lancamento[]; importadas?: Lancamento[]; contas: ContaRef[]
  categorias: FinanceCategoriaGrupo[]; centros: FinanceCentro[]; today: string
}) {
  const [periodo, setPeriodo] = useState<Periodo>({ tipo: 'mes', ano: Number(today.slice(0, 4)), mes: Number(today.slice(5, 7)) })
  const { start: perStart, end: perEnd } = useMemo(() => periodoRange(periodo), [periodo])
  const [contaFilter, setContaFilter] = useState('')
  const [tipoFilter, setTipoFilter] = useState<'todos' | 'entrada' | 'saida'>('todos')
  // Lançamento gerado pelo Faturamento nasce sem classificação (medido: 24 de 27).
  // Este filtro é o caminho pra achar e corrigir em lote, em vez de garimpar.
  const [faltando, setFaltando] = useState<null | 'categoria' | 'centro' | 'conta'>(null)
  const [query, setQuery] = useState('')
  // Recorte pelos cards de resumo (tipo + situação). null = tudo (card "Resultado").
  const [cardFilter, setCardFilter] = useState<null | 'rec_aberto' | 'rec_real' | 'desp_aberto' | 'desp_real'>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Lancamento | null>(null)
  // 'vencimento' = veio do botão Renegociar: o modal abre com a data em foco.
  const [editFoco, setEditFoco] = useState<'vencimento' | null>(null)
  const [baixa, setBaixa] = useState<Lancamento | null>(null)

  // Une lançamentos do Flow + linhas do extrato importado, escondendo as já promovidas
  // (um lançamento origem_tipo='conta_azul' "assume" o import_ref → não duplica).
  const merged = useMemo(() => {
    const promoted = new Set(
      lancamentos.filter(l => l.origem_tipo === 'conta_azul' && l.origem_ref).map(l => l.origem_ref as string)
    )
    return [...lancamentos, ...importadas.filter(e => !e.import_ref || !promoted.has(e.import_ref))]
  }, [lancamentos, importadas])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return merged.filter(l => {
      if (tipoFilter !== 'todos' && l.tipo !== tipoFilter) return false
      if (contaFilter && l.conta_id !== contaFilter) return false
      if (faltando === 'categoria' && (l.categoria ?? '').trim()) return false
      if (faltando === 'centro' && (l.centro_custo ?? '').trim()) return false
      if (faltando === 'conta' && l.conta_id) return false
      // A busca inclui os documentos: procurar por "2163" tem que achar a NF, e
      // até o nome do arquivo ficava de fora antes disso.
      if (q && !`${l.contato_nome ?? ''} ${l.descricao ?? ''} ${l.categoria ?? ''} ${l.doc_serie ?? ''} ${l.doc_numero ?? ''} ${textoBuscavel(l.anexos)}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [merged, tipoFilter, contaFilter, query, faltando])

  // Data efetiva: liquidação (se pago) ou vencimento (se em aberto).
  const effDate = (l: Lancamento) => (isPago(l.situacao) ? (l.data_liquidacao ?? l.vencimento) : l.vencimento)
  const inPeriodo = (l: Lancamento) => { const d = effDate(l); return !!d && d >= perStart && d <= perEnd }

  // Tabela única (estilo extrato): só os itens do período selecionado, ordenados por data.
  const rows = useMemo(() => {
    const inView = filtered.filter(l => {
      if (cardFilter) {
        const p = isPago(l.situacao)
        if (cardFilter === 'rec_aberto'  && !(l.tipo === 'entrada' && !p)) return false
        if (cardFilter === 'rec_real'    && !(l.tipo === 'entrada' &&  p)) return false
        if (cardFilter === 'desp_aberto' && !(l.tipo === 'saida'   && !p)) return false
        if (cardFilter === 'desp_real'   && !(l.tipo === 'saida'   &&  p)) return false
      }
      return inPeriodo(l)
    })
    inView.sort((a, b) => {
      const da = effDate(a) ?? '9999-12-31', db = effDate(b) ?? '9999-12-31'
      return da < db ? -1 : da > db ? 1 : 0
    })
    return inView
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, perStart, perEnd, cardFilter])

  // ── Seleção para edição em lote ──────────────────────────────────────────
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [loteAberto, setLoteAberto] = useState(false)
  const selecionaveis = useMemo(() => rows.filter(l => podeEditarEmLote(l).ok), [rows])

  // Seleção EFETIVA = o marcado que ainda está visível. Derivada na renderização, e
  // não sincronizada por efeito: se a pessoa muda o filtro ou o mês, o que saiu de
  // vista deixa de contar sozinho. Aplicar em lote a algo que ninguém está vendo é a
  // receita do arrependimento.
  const selIds = useMemo(
    () => selecionaveis.filter(l => selecionados.has(l.id)).map(l => l.id),
    [selecionaveis, selecionados],
  )

  function toggleUm(id: string) {
    setSelecionados(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleTodos() {
    setSelecionados(selIds.length === selecionaveis.length ? new Set() : new Set(selecionaveis.map(l => l.id)))
  }

  // Resumo do período (estilo Conta Azul): receita/despesa × em aberto/realizada.
  // Baixa PARCIAL entra aqui: o que já caiu conta como realizado e sai do "em
  // aberto". Antes o valor cheio ficava em "em aberto" e a parte recebida não
  // aparecia em lugar nenhum — os dois cards mentiam ao mesmo tempo.
  const resumo = useMemo(() => {
    const noMes = filtered.filter(inPeriodo)
    const sum = (arr: Lancamento[], fn: (l: Lancamento) => number) => arr.reduce((t, l) => t + fn(l), 0)
    const baixado = (l: Lancamento) => Math.min(val(l), Number(l.valor_realizado ?? 0))
    const falta   = (l: Lancamento) => Math.max(0, val(l) - Number(l.valor_realizado ?? 0))

    const split = (arr: Lancamento[]) => {
      const pagos   = arr.filter(l => isPago(l.situacao))
      const abertos = arr.filter(l => !isPago(l.situacao))
      return {
        real:   sum(pagos, realVal) + sum(abertos, baixado),
        aberto: sum(abertos, falta),
      }
    }
    const r = split(noMes.filter(l => l.tipo === 'entrada'))
    const d = split(noMes.filter(l => l.tipo === 'saida'))
    return {
      receitaAberto: r.aberto, receitaReal: r.real,
      despesaAberto: d.aberto, despesaReal: d.real,
      total: r.real + r.aberto - d.real - d.aberto,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, perStart, perEnd])

  const revisarCount = lancamentos.filter(l => l.revisar).length
  const contaMap = useMemo(() => Object.fromEntries(contas.map(c => [c.id, c])), [contas])
  const pendencias = useMemo(() => {
    const base = merged.filter(l => {
      if (tipoFilter !== 'todos' && l.tipo !== tipoFilter) return false
      if (contaFilter && l.conta_id !== contaFilter) return false
      return inPeriodo(l)
    })
    return {
      categoria: base.filter(l => !(l.categoria ?? '').trim()).length,
      centro: base.filter(l => !(l.centro_custo ?? '').trim()).length,
      conta: base.filter(l => !l.conta_id).length,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merged, tipoFilter, contaFilter, perStart, perEnd])

  const contaFilterOptions = useMemo(() => [{ value: '', label: 'Todas as contas' }, ...contas.map(c => ({ value: c.id, label: c.nome }))], [contas])
  const hasFilters = tipoFilter !== 'todos' || !!contaFilter || !!query.trim() || !!cardFilter || !!faltando
  function limparFiltros() { setTipoFilter('todos'); setContaFilter(''); setQuery(''); setCardFilter(null); setFaltando(null) }
  // Card clicado vira o recorte; zera o segmento tipo p/ não conflitar (toggle no mesmo card = tudo).
  function toggleCard(key: 'rec_aberto' | 'rec_real' | 'desp_aberto' | 'desp_real') {
    setTipoFilter('todos')
    setCardFilter(c => (c === key ? null : key))
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Lançamentos</h1>
          <p className="text-gray-500 text-sm mt-0.5">Controle mensal — a receber, a pagar, NF e boleto</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <PeriodoSelector periodo={periodo} setPeriodo={setPeriodo} today={today} />
          <button onClick={() => setCreating(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 transition">
            <Plus className="w-4 h-4" /> Nova
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="inline-flex bg-gray-100 rounded-xl p-0.5">
          {([['todos', 'Tudo'], ['entrada', 'A receber'], ['saida', 'A pagar']] as const).map(([v, label]) => (
            <button key={v} onClick={() => { setTipoFilter(v); setCardFilter(null) }} aria-pressed={tipoFilter === v}
              className={cn('px-3 py-1.5 text-sm font-medium rounded-[10px] transition-colors',
                tipoFilter === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
              {label}
            </button>
          ))}
        </div>
        <div className="w-52"><Select value={contaFilter} onChange={setContaFilter} options={contaFilterOptions} /></div>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por contato, descrição ou categoria"
            className="w-full pl-9 pr-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
        </div>
        {/* Pendências de classificação: contam sobre o período/tipo já filtrados,
            e o botão some quando não há nenhuma — não vale ocupar a barra à toa. */}
        {(['categoria', 'centro', 'conta'] as const).map(k => {
          const n = pendencias[k]
          if (!n && faltando !== k) return null
          const rotulo = k === 'categoria' ? 'Sem categoria' : k === 'centro' ? 'Sem centro de custo' : 'Sem conta'
          return (
            <button key={k} onClick={() => setFaltando(f => (f === k ? null : k))} aria-pressed={faltando === k}
              className={cn('inline-flex items-center gap-1.5 px-2.5 py-2 text-sm rounded-xl border transition-colors',
                faltando === k
                  ? 'border-amber-300 bg-amber-50 text-amber-800'
                  : 'border-gray-200 text-gray-500 hover:bg-gray-50')}>
              <AlertTriangle className="w-3.5 h-3.5" /> {rotulo}
              <span className="tabular-nums font-medium">{n}</span>
            </button>
          )
        })}
        {hasFilters && (
          <button onClick={limparFiltros} className="inline-flex items-center gap-1.5 px-2.5 py-2 text-sm text-gray-500 hover:text-gray-700 transition">
            <X className="w-3.5 h-3.5" /> Limpar filtros
          </button>
        )}
      </div>

      {/* Resumo do mês */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <Card label="Receitas em aberto" value={resumo.receitaAberto} tone="emerald-soft" active={cardFilter === 'rec_aberto'} onClick={() => toggleCard('rec_aberto')} />
        <Card label="Receitas realizadas" value={resumo.receitaReal} tone="emerald" active={cardFilter === 'rec_real'} onClick={() => toggleCard('rec_real')} />
        <Card label="Despesas em aberto" value={resumo.despesaAberto} tone="red-soft" active={cardFilter === 'desp_aberto'} onClick={() => toggleCard('desp_aberto')} />
        <Card label="Despesas realizadas" value={resumo.despesaReal} tone="red" active={cardFilter === 'desp_real'} onClick={() => toggleCard('desp_real')} />
        <Card label={`Resultado de ${periodoLabel(periodo)}`} value={resumo.total} tone="total" highlight active={!cardFilter} onClick={() => setCardFilter(null)} />
      </div>

      {revisarCount > 0 && (
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span><strong>{revisarCount}</strong> lançamento(s) com o documento alterado depois de lançado — revise (atualizar do documento ou marcar revisado).</span>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60 text-xs font-medium text-gray-400">
                <th className="pl-4 pr-1 py-2.5 w-8">
                  {/* Marca só o que é selecionável e está VISÍVEL — respeita o filtro
                      ativo, senão "todos" pegaria coisa que a pessoa não está vendo. */}
                  <input type="checkbox"
                    checked={selecionaveis.length > 0 && selIds.length === selecionaveis.length}
                    ref={el => { if (el) el.indeterminate = selIds.length > 0 && selIds.length < selecionaveis.length }}
                    onChange={toggleTodos} disabled={selecionaveis.length === 0}
                    title={selecionaveis.length ? 'Selecionar os visíveis' : 'Nada selecionável nesta lista'}
                    className="w-4 h-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500 disabled:opacity-30 cursor-pointer" />
                </th>
                <th className="text-left px-4 py-2.5 font-medium">Vencimento</th>
                <th className="text-left px-4 py-2.5 font-medium">Resumo do lançamento</th>
                <th className="text-left px-3 py-2.5 font-medium">Situação</th>
                <th className="text-right px-4 py-2.5 font-medium">Valor</th>
                <th className="text-center px-3 py-2.5 font-medium">NF</th>
                <th className="text-center px-3 py-2.5 font-medium">Boleto</th>
                <th className="w-44" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((l) => (
                <Row key={l.id} l={l} orgSlug={orgSlug} today={today}
                  conta={l.conta_id ? contaMap[l.conta_id] : undefined} onEdit={(l, foco) => { setEditFoco(foco ?? null); setEditing(l) }} onBaixa={setBaixa}
                  selecionado={selecionados.has(l.id)} onToggleSel={toggleUm} />
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <p className="text-sm text-gray-400 px-4 py-10 text-center">Nenhum lançamento neste mês.</p>
        )}
      </div>

      {(creating || editing) && (
        <LancamentoModal orgSlug={orgSlug} lancamento={editing} contas={contas} categorias={categorias} centros={centros}
          foco={editFoco}
          onClose={() => { setCreating(false); setEditing(null); setEditFoco(null) }} />
      )}
      {baixa && (
        <BaixaModal orgSlug={orgSlug} lancamento={baixa} contas={contas} onClose={() => setBaixa(null)} />
      )}

      {/* Barra flutuante da seleção */}
      {selIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-gray-900 text-[#fff] rounded-2xl shadow-xl px-4 py-3">
          <span className="text-sm font-medium tabular-nums">
            {selIds.length} selecionado{selIds.length > 1 ? 's' : ''}
          </span>
          <button onClick={() => setLoteAberto(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-orange-600 hover:bg-orange-700 transition-colors active:scale-[0.97]">
            <Pencil className="w-3.5 h-3.5" /> Editar em lote
          </button>
          <button onClick={() => setSelecionados(new Set())}
            className="p-1.5 rounded-lg text-gray-400 hover:text-[#fff] hover:bg-white/10 transition-colors" title="Limpar seleção">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {loteAberto && (
        <LoteModal orgSlug={orgSlug} ids={selIds} contas={contas}
          // Direção do lote: só é 'entrada'/'saida' quando TODOS concordam.
          // Misturado, nenhuma categoria de direção única serve.
          direcao={(() => {
            const tipos = new Set(merged.filter(l => selecionados.has(l.id)).map(l => l.tipo))
            return tipos.size === 1 ? ([...tipos][0] as 'entrada' | 'saida') : null
          })()}
          categorias={categorias} centros={centros}
          onClose={() => setLoteAberto(false)}
          onDone={() => { setLoteAberto(false); setSelecionados(new Set()) }} />
      )}
    </div>
  )
}

/** Pode entrar numa edição em lote? Linha do Conta Azul ainda não é lançamento, e
 *  conciliado (baixa total OU parcial) não se mexe — precisa desconciliar antes. */
/** Texto do modal de exclusão — diz o estrago antes, não depois. */
function descreveImpacto(i: ImpactoExclusao | null): string {
  if (!i) return 'Confirma a exclusão?'
  if (i.escopo === 'documento') {
    const doc = docNumero(i.doc_serie, i.doc_numero)
    const n = i.parcelas ?? 1
    const total = formatBRL(Number(i.valor_total ?? 0))
    return `${doc} volta para o Faturamento e ${n === 1 ? 'a parcela some' : `as ${n} parcelas somem`} do fluxo de caixa (${total} no total). `
      + 'O documento em si não é apagado — dá pra faturar de novo. Não dá pra desfazer a exclusão das parcelas.'
  }
  return 'Este lançamento será excluído do fluxo de caixa. Não dá pra desfazer.'
}

export function podeEditarEmLote(l: Lancamento): { ok: boolean; motivo?: string } {
  if (l.source === 'importado') return { ok: false, motivo: 'Linha do Conta Azul — edite para virar lançamento do Flow primeiro' }
  if (isPago(l.situacao)) return { ok: false, motivo: 'Já conciliado — desconcilie antes de alterar' }
  if (Number(l.valor_realizado ?? 0) > 0) return { ok: false, motivo: 'Tem baixa parcial conciliada — desconcilie antes de alterar' }
  return { ok: true }
}

function Row({ l, orgSlug, today, conta, onEdit, onBaixa, selecionado, onToggleSel }: {
  l: Lancamento; orgSlug: string; today: string; conta?: ContaRef
  onEdit: (l: Lancamento, foco?: 'vencimento') => void; onBaixa: (l: Lancamento) => void
  selecionado: boolean; onToggleSel: (id: string) => void
}) {
  const sel = podeEditarEmLote(l)
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [confirmDel, setConfirmDel] = useState(false)
  const [impacto, setImpacto] = useState<ImpactoExclusao | null>(null)
  const [confirmDescarte, setConfirmDescarte] = useState(false)
  const paid = isPago(l.situacao)
  const overdue = !paid && !!l.vencimento && l.vencimento < today
  const isSaida = l.tipo === 'saida'
  const imported = l.source === 'importado'
  // Documento anexado vale como "tem NF"/"tem boleto" — é prova, não promessa.
  // O tipo é o que a pessoa escolhe no seletor ao anexar ('NF' | 'Boleto' | 'Outro').
  const temAnexoNf = !!l.anexos?.some(a => a.tipo === 'NF')
  const temAnexoBoleto = !!l.anexos?.some(a => a.tipo === 'Boleto')
  // A coluna mostra o VENCIMENTO; quando baixado, a data da baixa vai como linha secundária.
  const pagoEm = paid ? (l.data_liquidacao ?? null) : null
  // Baixa parcial: ainda está em aberto, mas parte já caiu. Sem este selo a linha
  // dizia "Em aberto" com o valor cheio, como se nada tivesse entrado.
  const jaBaixado = Math.min(val(l), Number(l.valor_realizado ?? 0))
  const parcial = !paid && jaBaixado > 0
  const falta = val(l) - jaBaixado
  const status = paid
    ? { label: isSaida ? 'Pago' : 'Recebido', cls: 'bg-emerald-50 text-emerald-700' }
    : parcial
      // Continua vermelho se além de parcial estiver vencido — o atraso não some.
      ? { label: 'Parcial', cls: overdue ? 'bg-red-50 text-red-700' : 'bg-sky-50 text-sky-700' }
      : overdue
        ? { label: 'Atrasado', cls: 'bg-red-50 text-red-700' }
        : { label: 'Em aberto', cls: 'bg-amber-50 text-amber-700' }

  function toggleNf() { startTransition(async () => { await setLancamentoFlags(orgSlug, l.id, !l.nf_emitida, l.boleto_gerado); router.refresh() }) }
  function toggleBoleto() { startTransition(async () => { await setLancamentoFlags(orgSlug, l.id, l.nf_emitida, !l.boleto_gerado); router.refresh() }) }
  function reabrir() { startTransition(async () => { await reabrirLancamento(orgSlug, l.id); router.refresh() }) }
  function atualizarDoDoc() { startTransition(async () => { await ressincronizarLancamento(orgSlug, l.id); router.refresh() }) }
  function marcarRevisado() { startTransition(async () => { await marcarLancamentoRevisado(orgSlug, l.id); router.refresh() }) }
  function descartar() {
    setConfirmDescarte(false)
    startTransition(async () => {
      const r = await descartarExtrato(orgSlug, l.import_ref ?? '')
      if (r?.error) toast.error(r.error)
      else { toast.success('Linha descartada.'); router.refresh() }
    })
  }
  function pedirExclusao() {
    startTransition(async () => {
      const imp = await impactoExcluirLancamento(l.id)
      if (!imp.pode) { toast.error(imp.motivo ?? 'Não é possível excluir este lançamento.'); return }
      setImpacto(imp)
      setConfirmDel(true)
    })
  }
  function remover() {
    setConfirmDel(false)
    startTransition(async () => { const r = await deleteLancamento(orgSlug, l.id); if (r?.error) toast.error(r.error); else { toast.success('Lançamento excluído.'); router.refresh() } })
  }

  return (
    <tr className={cn('group/linha transition-colors', isPending ? 'opacity-50' : 'hover:bg-orange-50/40', l.revisar && 'bg-amber-50/40')}>
      <td className="pl-4 pr-1 py-2.5">
        <input type="checkbox" checked={selecionado} disabled={!sel.ok}
          onChange={() => onToggleSel(l.id)} title={sel.motivo ?? 'Selecionar'}
          className="w-4 h-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer" />
      </td>
      <td className={cn('px-4 py-2.5 text-sm whitespace-nowrap', overdue ? 'text-red-600 font-medium' : 'text-gray-600')}>
        <div>{formatDateBR(l.vencimento)}</div>
        {pagoEm && <div className="text-[11px] text-emerald-600 mt-0.5">{isSaida ? 'pago' : 'receb.'} {formatDateBR(pagoEm)}</div>}
      </td>
      <td className="px-4 py-2.5 text-sm">
        <div className="flex items-start gap-2">
          {isSaida ? <ArrowUpCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" /> : <ArrowDownCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />}
          <div className="min-w-0">
            {/* Clicar no nome abre o modal (ver/editar). O lápis só aparece no hover
                pra não poluir a lista — o alvo de clique é a linha toda do texto. */}
            <button type="button" onClick={() => onEdit(l)}
              title={imported ? 'Ver e editar — vira lançamento do Flow' : 'Ver e editar'}
              className="group/nome flex items-center gap-1.5 min-w-0 text-left">
              <span className="text-gray-900 font-medium truncate group-hover/nome:text-orange-600 transition-colors">
                {l.contato_nome ?? l.descricao ?? '—'}
              </span>
              <Pencil className="w-3 h-3 text-gray-300 shrink-0 opacity-0 group-hover/linha:opacity-100 group-hover/nome:text-orange-500 transition-opacity" />
            </button>
            {l.contato_nome && l.descricao && (
              <button type="button" onClick={() => onEdit(l)}
                className="block text-xs text-gray-500 truncate text-left max-w-full hover:text-gray-700 transition-colors">
                {l.descricao}
              </button>
            )}
            {(l.parcela_num || l.categoria || conta || imported || l.doc_numero) && (
              <div className="flex flex-wrap items-center gap-1 mt-1">
                {/* Código do documento (MX 1567 / PP 1783 / FEE 34) — vem primeiro:
                    é por ele que se liga o recebimento ao trabalho. */}
                <DocChip orgSlug={orgSlug} doc={{ id: l.origem_id ?? null, serie: l.doc_serie ?? null, numero: l.doc_numero ?? null, origem: l.doc_origem ?? null, producaoTipo: l.doc_producao_tipo }} />
                {l.parcela_num && l.parcela_total && (
                  <span className="text-[10px] font-medium text-gray-600 bg-gray-100 rounded-md px-1.5 py-0.5 tabular-nums">{l.parcela_num}/{l.parcela_total}</span>
                )}
                {l.categoria && <span className="text-[10px] font-medium text-gray-600 bg-gray-100 rounded-md px-1.5 py-0.5">{l.categoria}</span>}
                {conta && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-md px-1.5 py-0.5">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: conta.cor ?? '#cbd5e1' }} />{conta.nome}
                  </span>
                )}
                {imported && <span className="text-[10px] font-medium text-sky-700 bg-sky-50 rounded-md px-1.5 py-0.5">Conta Azul</span>}
                {/* Anexos na própria linha: dá pra ver que a NF está lá sem abrir o
                    modal — foi justamente não ver isso que fez parecer que o anexo
                    não tinha salvado. */}
                {/* Documento COM número vira etiqueta própria (NF 2163 · agência) e
                    abre o PDF no clique — é por esse número que se procura depois.
                    O resto continua contado no clipe. */}
                {l.anexos?.filter(a => a.numero).map((a, k) => (
                  a.url ? (
                    <a key={`d${k}`} href={a.url} target="_blank" rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      title={`${a.nome}${a.emitente ? ` — ${EMITENTE_LABEL[a.emitente]}` : ''}`}
                      className="inline-flex items-center gap-1 text-[10px] font-medium text-orange-700 bg-orange-50 rounded-md px-1.5 py-0.5 hover:bg-orange-100 transition-colors">
                      {chipDocumento(a)}
                      {a.emitente && <span className="text-orange-400">· {EMITENTE_LABEL[a.emitente]}</span>}
                    </a>
                  ) : (
                    <span key={`d${k}`} title="Número registrado — arquivo ainda não anexado"
                      className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-500 border border-dashed border-gray-300 rounded-md px-1.5 py-0.5">
                      {chipDocumento(a)}
                      {a.emitente && <span className="text-gray-400">· {EMITENTE_LABEL[a.emitente]}</span>}
                    </span>
                  )
                ))}
                {(l.anexos?.filter(a => !a.numero && a.url).length ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-600 bg-gray-100 rounded-md px-1.5 py-0.5"
                    title={l.anexos!.filter(a => !a.numero && a.url).map(a => a.nome).join(', ')}>
                    <Paperclip className="w-2.5 h-2.5" />{l.anexos!.filter(a => !a.numero && a.url).length}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', status.cls)}>
            {paid && <Check className="w-3 h-3" />}{status.label}
          </span>
          {l.revisar && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 text-[10px] font-medium px-1.5 py-0.5" title="Documento alterado depois de lançado"><AlertTriangle className="w-2.5 h-2.5" /> alterado</span>}
        </div>
      </td>
      <td className={cn('px-4 py-2.5 text-sm font-medium text-right whitespace-nowrap', isSaida ? 'text-red-600' : 'text-gray-900')}>
        {isSaida ? '− ' : ''}{formatBRL(val(l))}
        {/* O valor cheio é o do documento; o que importa pra cobrança é o que falta. */}
        {parcial && (
          <span className="block text-[11px] font-normal text-gray-500 tabular-nums"
            title={`Já ${isSaida ? 'pago' : 'recebido'}: ${formatBRL(jaBaixado)}`}>
            falta {formatBRL(falta)}
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-center">
        {imported
          ? (l.nf_emitida ? <FileText className="w-4 h-4 text-gray-300 inline" /> : <span className="text-gray-300">—</span>)
          : <Flag on={l.nf_emitida || temAnexoNf} viaAnexo={temAnexoNf} onClick={toggleNf} label="NF" />}
      </td>
      <td className="px-3 py-2.5 text-center">
        {imported ? <span className="text-gray-300">—</span>
          : <Flag on={l.boleto_gerado || temAnexoBoleto} viaAnexo={temAnexoBoleto} onClick={toggleBoleto} label="Boleto" />}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center justify-end gap-1">
          {imported ? (
            <>
              <button onClick={() => onEdit(l)} title="Editar — vira lançamento do Flow"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition">
                <Pencil className="w-3.5 h-3.5" /> Editar
              </button>
              <button onClick={() => setConfirmDescarte(true)} disabled={isPending}
                title="Descartar — some da lista e não volta no próximo import"
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <ConfirmDialog
                open={confirmDescarte} loading={isPending}
                title="Descartar linha da Conta Azul"
                description="Ela some da lista e continua fora mesmo depois de reimportar o extrato. O registro na Conta Azul não é alterado."
                confirmLabel="Descartar"
                onConfirm={descartar}
                onCancel={() => setConfirmDescarte(false)}
              />
            </>
          ) : (
            <>
              {l.revisar && (
                <>
                  <button onClick={atualizarDoDoc} disabled={isPending} title="Atualizar do documento"
                    className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 transition disabled:opacity-50">
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={marcarRevisado} disabled={isPending} title="Marcar como revisado"
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition disabled:opacity-50"><Check className="w-3.5 h-3.5" /></button>
                </>
              )}
              {/* Renegociar prazo: o vencimento sempre foi editável no modal, mas
                  ficava escondido atrás do lápis e ninguém achava. Item vencido
                  ganha a ação explícita, com o campo de data já em foco. */}
              {overdue && (
                <button onClick={() => onEdit(l, 'vencimento')} disabled={isPending}
                  title="Renegociar o prazo de pagamento"
                  className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition disabled:opacity-50">
                  <CalendarClock className="w-3.5 h-3.5" /> Renegociar
                </button>
              )}
              <button onClick={() => onEdit(l)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition" title="Editar"><Pencil className="w-3.5 h-3.5" /></button>
              {/* A trava real está na RPC (136): pago/recebido, baixa parcial ou
                  conciliado recusam com motivo. Aqui o botão aparece sempre e o
                  servidor é quem diz não — evita ter duas regras divergentes. */}
              <button onClick={pedirExclusao} disabled={isPending} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition disabled:opacity-50" title="Excluir"><Trash2 className="w-3.5 h-3.5" /></button>
              <ConfirmDialog
                open={confirmDel} loading={isPending}
                title={impacto?.escopo === 'documento' ? 'Estornar o faturamento' : 'Excluir lançamento'}
                description={descreveImpacto(impacto)}
                confirmLabel={impacto?.escopo === 'documento' ? 'Estornar faturamento' : 'Excluir'}
                onConfirm={remover} onCancel={() => setConfirmDel(false)}
              />
              {paid ? (
                <button onClick={reabrir} disabled={isPending} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-gray-500 hover:bg-gray-100 transition disabled:opacity-50">
                  <RotateCcw className="w-3.5 h-3.5" /> Reabrir
                </button>
              ) : (
                <button onClick={() => onBaixa(l)} disabled={isPending}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-[#fff] hover:bg-emerald-700 transition disabled:opacity-50">
                  <Check className="w-3.5 h-3.5" /> {isSaida ? 'Pagar' : 'Receber'}
                </button>
              )}
            </>
          )}
        </div>
      </td>
    </tr>
  )
}

const periodoInputCls = 'bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent'

function PeriodoSelector({ periodo, setPeriodo, today }: { periodo: Periodo; setPeriodo: (p: Periodo) => void; today: string }) {
  const modeOptions = [{ value: 'mes', label: 'Mês' }, { value: 'ano', label: 'Ano' }, { value: 'custom', label: 'Período' }]
  function setMode(tipo: string) {
    if (tipo === periodo.tipo) return
    if (tipo === 'custom') { const r = periodoRange(periodo); setPeriodo({ tipo: 'custom', start: r.start, end: r.end }); return }
    const ano = periodo.tipo === 'custom' ? Number((periodo.start || today).slice(0, 4)) : periodo.ano
    if (tipo === 'ano') { setPeriodo({ tipo: 'ano', ano }); return }
    const mes = periodo.tipo === 'mes' ? periodo.mes : Number(today.slice(5, 7))
    setPeriodo({ tipo: 'mes', ano, mes })
  }
  return (
    <div className="flex items-center gap-2">
      <div className="w-28"><Select value={periodo.tipo} onChange={setMode} options={modeOptions} size="sm" /></div>
      {periodo.tipo === 'custom' ? (
        <div className="flex items-center gap-1.5">
          <input type="date" value={periodo.start} max={periodo.end || undefined}
            onChange={e => setPeriodo({ ...periodo, start: e.target.value })} className={periodoInputCls} />
          <span className="text-gray-400 text-sm">–</span>
          <input type="date" value={periodo.end} min={periodo.start || undefined}
            onChange={e => setPeriodo({ ...periodo, end: e.target.value })} className={periodoInputCls} />
        </div>
      ) : (
        <div className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5">
          <button type="button" onClick={() => setPeriodo(shiftPeriodo(periodo, -1))} className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition"><ChevronLeft className="w-4 h-4" /></button>
          <span className="px-3 text-sm font-medium text-gray-800 min-w-[110px] text-center">{periodoLabel(periodo)}</span>
          <button type="button" onClick={() => setPeriodo(shiftPeriodo(periodo, 1))} className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition"><ChevronRight className="w-4 h-4" /></button>
        </div>
      )}
    </div>
  )
}

function Card({ label, value, tone, highlight, active, onClick }: {
  label: string; value: number; tone: string; highlight?: boolean; active?: boolean; onClick?: () => void
}) {
  const color = tone === 'emerald' ? 'text-emerald-600'
    : tone === 'emerald-soft' ? 'text-emerald-500'
    : tone === 'red' ? 'text-red-600'
    : tone === 'red-soft' ? 'text-red-500'
    : value >= 0 ? 'text-gray-900' : 'text-red-600'
  return (
    <button type="button" onClick={onClick}
      className={cn('w-full text-left rounded-xl border bg-white px-4 py-3 transition-colors active:scale-[0.99]',
        active ? 'border-orange-300 ring-2 ring-orange-200' : highlight ? 'border-gray-300 shadow-sm hover:border-gray-400' : 'border-gray-200 hover:border-gray-300')}>
      <p className="text-[11px] font-medium text-gray-400 mb-1">{label}</p>
      <p className={cn('text-base font-semibold', color)}>{formatBRL(value)}</p>
    </button>
  )
}

function Info({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-gray-500">{label}</dt>
      <dd className={cn('text-gray-800 text-right', strong && 'font-semibold')}>{value}</dd>
    </div>
  )
}

function Flag({ on, onClick, label, viaAnexo = false }: {
  on: boolean; onClick: () => void; label: string
  /** Ligado porque o documento está ANEXADO, não porque alguém marcou o flag à mão.
   *  O anexo é prova; o flag é promessa. Vale mais, e o título diz de onde veio. */
  viaAnexo?: boolean
}) {
  const Icon = label === 'NF' ? FileText : Receipt
  return (
    <button onClick={onClick}
      title={viaAnexo ? `${label} anexada` : on ? `${label} marcada — clique para desmarcar` : `Marcar ${label}`}
      className={cn('inline-flex items-center justify-center w-7 h-7 rounded-lg border transition-colors active:scale-[0.97]',
        on ? 'bg-orange-600 border-orange-600 text-[#fff]' : 'border-gray-200 text-gray-300 hover:text-gray-500')}>
      <Icon className="w-3.5 h-3.5" />
    </button>
  )
}

const TIPO_OPTIONS = [{ value: 'saida', label: 'Saída (pagar)' }, { value: 'entrada', label: 'Entrada (receber)' }]
const FORMA_OPTIONS = [
  { value: '', label: '—' },
  { value: 'pix', label: 'Pix' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'cartao', label: 'Cartão' },
  { value: 'dinheiro', label: 'Dinheiro' },
]

function LancamentoModal({ orgSlug, lancamento, contas, categorias, centros, foco, onClose }: {
  orgSlug: string; lancamento: Lancamento | null; contas: ContaRef[]
  categorias: FinanceCategoriaGrupo[]; centros: FinanceCentro[]
  foco?: 'vencimento' | null; onClose: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  // Importado (Conta Azul): editável — ao salvar, é PROMOVIDO a lançamento do Flow.
  const imported = lancamento?.source === 'importado'
  // Texto/valor travados só quando existe DOCUMENTO vivo por trás (produção/mídia):
  // lá o documento é a fonte e a próxima regeração sobrescreveria o que fosse
  // editado aqui. Conta Azul/OFX/manual são livres — não há de onde ressincronizar.
  const readonly = !!lancamento && !imported
    && lancamento.origem_tipo !== 'manual' && lancamento.origem_tipo !== 'conta_azul' && lancamento.origem_tipo !== 'ofx'
  const vencRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (foco !== 'vencimento') return
    const t = setTimeout(() => { vencRef.current?.focus(); vencRef.current?.showPicker?.() }, 80)
    return () => clearTimeout(t)
  }, [foco])
  const [form, setForm] = useState({
    tipo: lancamento?.tipo ?? 'saida',
    descricao: lancamento?.descricao ?? '',
    contato_nome: lancamento?.contato_nome ?? '',
    valor: lancamento != null ? String(lancamento.valor).replace('.', ',') : '',
    vencimento: lancamento?.vencimento ?? '',
    competencia: lancamento?.competencia ?? '',
    conta_id: lancamento?.conta_id ?? '',
    categoria: lancamento?.categoria ?? '',
    centro_custo: lancamento?.centro_custo ?? '',
    forma_pagamento: lancamento?.forma_pagamento ?? '',
    observacao: lancamento?.observacao ?? '',
  })

  const catOptions = useMemo(() => {
    const dir = form.tipo === 'saida' ? 'saida' : 'entrada'
    const nomes = categoriaNomes(categorias, dir)
    // A categoria já gravada continua listada mesmo que hoje não sirva à direção
    // (mudou de tipo depois, ou veio do import) — senão editar outro campo do
    // lançamento apagaria a categoria em silêncio.
    const atual = lancamento?.categoria
    const extra = atual && !nomes.includes(atual) ? [atual] : []
    return [{ value: '', label: '—' }, ...[...nomes, ...extra].map(n => ({ value: n, label: n }))]
  }, [categorias, form.tipo, lancamento?.categoria])
  const contaOptions = useMemo(() => [{ value: '', label: '—' }, ...contas.map(c => ({ value: c.id, label: c.nome }))], [contas])
  const centroOptions = useMemo(() => {
    const ativos = centros.filter(c => !c.arquivado)
    const atual = lancamento?.centro_custo
    // mantém o centro atual visível/selecionável mesmo se já estiver arquivado
    const extra = atual && !ativos.some(c => c.nome === atual) ? [{ value: atual, label: `${atual} (arquivado)` }] : []
    return [{ value: '', label: '—' }, ...ativos.map(c => ({ value: c.nome, label: c.nome })), ...extra]
  }, [centros, lancamento])

  const liquidado = !!lancamento && !imported && (lancamento.situacao === 'pago' || lancamento.situacao === 'recebido')
  const contaNome = lancamento?.conta_id ? contas.find(c => c.id === lancamento.conta_id)?.nome : null
  const [anexos, setAnexos] = useState<Anexo[]>(lancamento?.anexos ?? [])
  const [anexoTipo, setAnexoTipo] = useState('NF')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  /** Índice do documento que está esperando arquivo (null = anexo novo). */
  const anexoAlvo = useRef<number | null>(null)
  const [modo, setModo] = useState('unico')          // unico | parcelado | recorrente
  const [parcelas, setParcelas] = useState('2')

  // Importado (sem row real ainda) e lançamento novo: os anexos ficam "staged"
  // e só são gravados ao salvar (promover_extrato / create_lancamento os recebem
  // no payload). Lançamento do Flow já salvo persiste na hora (set_lancamento_anexos).
  const stageAnexos = imported || !lancamento
  async function persistAnexos(next: Anexo[]) {
    setAnexos(next)
    if (!stageAnexos && lancamento) { await setLancamentoAnexos(orgSlug, lancamento.id, next); router.refresh() }
  }
  async function onPickFile(file: File) {
    setUploading(true); setError('')
    const alvo = anexoAlvo.current
    anexoAlvo.current = null
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf'
      const url = await uploadFile('lancamentos', `${crypto.randomUUID()}.${ext}`, file)
      // O número já vinha sendo escrito no NOME do arquivo — então lê de lá, mas
      // só quando não há ambiguidade (ver numeroDoNome). Nunca sobrescreve um
      // número que a pessoa digitou.
      const lido = numeroDoNome(file.name)
      if (alvo != null && anexos[alvo]) {
        await persistAnexos(anexos.map((x, j) => (j === alvo
          ? { ...x, url, nome: file.name, numero: x.numero || lido }
          : x)))
      } else {
        await persistAnexos([...anexos, { url, nome: file.name, tipo: anexoTipo, numero: lido }])
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha no upload') }
    finally { setUploading(false) }
  }
  function reabrir() {
    if (!lancamento) return
    startTransition(async () => { await reabrirLancamento(orgSlug, lancamento.id); onClose(); router.refresh() })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!readonly && !form.descricao.trim() && !form.contato_nome.trim()) { setError('Informe a descrição ou o contato'); return }
    const data = {
      tipo: form.tipo,
      descricao: form.descricao.trim() || null,
      contato_nome: form.contato_nome.trim() || null,
      valor: parseBR(form.valor),
      vencimento: form.vencimento || null,
      competencia: form.competencia || null,
      conta_id: form.conta_id || null,
      categoria: form.categoria || null,
      centro_custo: form.centro_custo || null,
      forma_pagamento: form.forma_pagamento || null,
      // Renegociação deixa rastro: sem isso ninguém lembra qual era o prazo original
      // nem quando mudou — e é essa a pergunta que aparece na cobrança.
      observacao: (() => {
        const obs = form.observacao.trim()
        const antes = lancamento?.vencimento ?? null
        if (foco !== 'vencimento' || !antes || !form.vencimento || form.vencimento === antes) return obs || null
        const nota = `Prazo renegociado em ${formatDateBR(new Date().toISOString().slice(0, 10))}: ${formatDateBR(antes)} → ${formatDateBR(form.vencimento)}`
        return obs ? `${nota}\n${obs}` : nota
      })(),
    }
    // Promoção: importado vira lançamento do Flow, carregando a liquidação do snapshot.
    if (imported && lancamento) {
      const numOrNull = (v: number | string | null) => (v == null ? null : String(v))
      const payload = {
        ...data,
        anexos,
        situacao: lancamento.situacao,
        data_liquidacao: lancamento.data_liquidacao ?? null,
        valor_realizado: numOrNull(lancamento.valor_realizado),
        juros: numOrNull(lancamento.juros), multa: numOrNull(lancamento.multa),
        desconto: numOrNull(lancamento.desconto), tarifa: numOrNull(lancamento.tarifa),
      }
      startTransition(async () => {
        const res = await promoverExtrato(orgSlug, lancamento.import_ref ?? '', payload)
        if (res?.error) { setError(res.error); return }
        onClose(); router.refresh()
      })
      return
    }
    const n = Math.max(parseInt(parcelas || '1', 10) || 1, 1)
    const serie = !lancamento && modo !== 'unico'
    if (serie && !form.vencimento) { setError('Defina o vencimento da 1ª ocorrência'); return }
    if (serie && n < 2) { setError('Informe ao menos 2 ' + (modo === 'parcelado' ? 'parcelas' : 'repetições')); return }
    startTransition(async () => {
      const res = lancamento
        ? await updateLancamento(orgSlug, lancamento.id, data)
        : serie
          ? await createLancamentosSerie(orgSlug, data, modo, n)
          : await createLancamento(orgSlug, { ...data, anexos })
      if (res?.error) { setError(res.error); return }
      onClose(); router.refresh()
    })
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="modal-card w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-xl border border-gray-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h2 className="text-base font-semibold text-gray-900">{imported ? 'Editar (Conta Azul → Flow)' : lancamento ? 'Editar lançamento' : 'Novo lançamento'}</h2>
          <button aria-label="Fechar" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          {imported && <p className="text-xs text-sky-800 bg-sky-50 rounded-lg px-3 py-2">Linha importada da <strong>Conta Azul</strong>. Ao salvar, ela vira um lançamento do Flow (editável) e passa a ser a versão oficial — a linha importada some, mesmo após reimportar o extrato.</p>}
          {readonly && (
            <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 space-y-1.5">
              {lancamento?.doc_numero && (
                <div className="flex items-center gap-2">
                  <span>Origem:</span>
                  <DocChip orgSlug={orgSlug} size="md" doc={{ id: lancamento.origem_id ?? null, serie: lancamento.doc_serie ?? null, numero: lancamento.doc_numero ?? null, origem: lancamento.doc_origem ?? null, producaoTipo: lancamento.doc_producao_tipo }} />
                </div>
              )}
              <p>Lançamento gerado por documento ({lancamento?.origem_tipo}). Valor e contato vêm do documento; aqui você ajusta os campos do financeiro.</p>
            </div>
          )}

          {!readonly && (
            <div>
              <label className={labelCls}>Tipo</label>
              <Select value={form.tipo} onChange={v => setForm(f => ({ ...f, tipo: v, categoria: '' }))} options={TIPO_OPTIONS} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Contato</label>
              <input type="text" value={form.contato_nome} disabled={readonly}
                onChange={e => setForm(f => ({ ...f, contato_nome: e.target.value }))}
                placeholder="Cliente / fornecedor" className={cn(inputCls, readonly && 'opacity-60')} />
            </div>
            <div>
              <label className={labelCls}>Valor (R$)</label>
              <input type="text" inputMode="decimal" value={form.valor} disabled={readonly}
                onChange={e => setForm(f => ({ ...f, valor: e.target.value }))} placeholder="0,00" className={cn(inputCls, readonly && 'opacity-60')} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Descrição</label>
            <input type="text" value={form.descricao} disabled={readonly}
              onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
              placeholder="Ex.: Honorários contábeis" className={cn(inputCls, readonly && 'opacity-60')} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Vencimento{foco === 'vencimento' && <span className="ml-1 text-orange-600 font-normal">— renegociando</span>}</label>
              <input ref={vencRef} type="date" value={form.vencimento} onChange={e => setForm(f => ({ ...f, vencimento: e.target.value }))}
                className={cn(inputCls, foco === 'vencimento' && 'ring-2 ring-orange-400 border-transparent')} />
            </div>
            <div>
              <label className={labelCls}>Competência</label>
              <input type="date" value={form.competencia} onChange={e => setForm(f => ({ ...f, competencia: e.target.value }))} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Categoria</label>
              <Select value={form.categoria} onChange={v => setForm(f => ({ ...f, categoria: v }))} options={catOptions} placeholder="—" />
            </div>
            <div>
              <label className={labelCls}>Centro de custo</label>
              <Select value={form.centro_custo} onChange={v => setForm(f => ({ ...f, centro_custo: v }))} options={centroOptions} placeholder="—" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Conta</label>
              <Select value={form.conta_id} onChange={v => setForm(f => ({ ...f, conta_id: v }))} options={contaOptions} placeholder="—" />
            </div>
            <div>
              <label className={labelCls}>Forma</label>
              <Select value={form.forma_pagamento} onChange={v => setForm(f => ({ ...f, forma_pagamento: v }))} options={FORMA_OPTIONS} placeholder="—" />
            </div>
          </div>

          <div>
            <label className={labelCls}>Observação</label>
            <textarea rows={2} value={form.observacao} onChange={e => setForm(f => ({ ...f, observacao: e.target.value }))} className={cn(inputCls, 'resize-none')} />
          </div>

          {!lancamento && (
            <div className="border-t border-gray-100 pt-4 space-y-3">
              <div>
                <label className={labelCls}>Repetição</label>
                <Select value={modo} onChange={setModo} options={[
                  { value: 'unico', label: 'Único' },
                  { value: 'parcelado', label: 'Parcelado (divide o valor)' },
                  { value: 'recorrente', label: 'Recorrente (repete o valor)' },
                ]} />
              </div>
              {modo !== 'unico' && (
                <div className="grid grid-cols-2 gap-3 items-start">
                  <div>
                    <label className={labelCls}>{modo === 'parcelado' ? 'Nº de parcelas' : 'Nº de meses'}</label>
                    <input type="text" inputMode="numeric" value={parcelas}
                      onChange={e => setParcelas(e.target.value.replace(/\D/g, ''))} className={inputCls} />
                  </div>
                  <p className="text-[11px] text-gray-400 pt-6">
                    {modo === 'parcelado'
                      ? 'Divide o valor em parcelas mensais a partir do vencimento (a última leva o resto).'
                      : 'Repete o valor cheio todo mês a partir do vencimento.'}
                  </p>
                </div>
              )}
            </div>
          )}

          {liquidado && lancamento && (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3.5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-emerald-700">{lancamento.tipo === 'saida' ? 'Pago' : 'Recebido'}</span>
                <button type="button" onClick={reabrir} disabled={isPending}
                  className="text-xs text-gray-500 hover:text-gray-700 inline-flex items-center gap-1 disabled:opacity-50"><RotateCcw className="w-3 h-3" /> Reabrir</button>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <Info label="Data" value={formatDateBR(lancamento.data_liquidacao)} />
                <Info label="Valor realizado" value={formatBRL(Number(lancamento.valor_realizado ?? lancamento.valor ?? 0))} strong />
                {contaNome && <Info label="Conta" value={contaNome} />}
                {lancamento.forma_pagamento && <Info label="Forma" value={lancamento.forma_pagamento} />}
                {Number(lancamento.juros ?? 0) > 0 && <Info label="Juros" value={formatBRL(Number(lancamento.juros))} />}
                {Number(lancamento.multa ?? 0) > 0 && <Info label="Multa" value={formatBRL(Number(lancamento.multa))} />}
                {Number(lancamento.desconto ?? 0) > 0 && <Info label="Desconto" value={formatBRL(Number(lancamento.desconto))} />}
                {Number(lancamento.tarifa ?? 0) > 0 && <Info label="Tarifa" value={formatBRL(Number(lancamento.tarifa))} />}
              </dl>
            </div>
          )}

          {(lancamento || modo === 'unico') && (
            <div className="border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-gray-600 inline-flex items-center gap-1.5"><Paperclip className="w-3.5 h-3.5" /> Anexos <span className="font-normal text-gray-400">(NF, boleto, nota)</span></label>
                <div className="flex items-center gap-1.5">
                  <div className="w-28"><Select value={anexoTipo} onChange={setAnexoTipo} size="sm" options={[{ value: 'NF', label: 'NF' }, { value: 'Boleto', label: 'Boleto' }, { value: 'Outro', label: 'Outro' }]} /></div>
                  <input ref={fileRef} type="file" accept=".pdf,image/*" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) onPickFile(f); e.target.value = '' }} />
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition disabled:opacity-50">
                    {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Anexar
                  </button>
                  {/* O número da NF costuma chegar antes do PDF — dá pra registrar
                      só ele e anexar o arquivo na mesma linha quando chegar. */}
                  <button type="button" onClick={() => persistAnexos([...anexos, { url: '', nome: '', tipo: anexoTipo }])}
                    title="Registrar o número agora e anexar o arquivo depois"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition">
                    <Plus className="w-3.5 h-3.5" /> Só o número
                  </button>
                </div>
              </div>
              {anexos.length === 0 ? (
                <p className="text-xs text-gray-400 py-1">Nenhum documento. Anexe a NF, o boleto ou registre só o número.</p>
              ) : (
                <ul className="space-y-1.5">
                  {anexos.map((a, i) => {
                    const patch = (p: Partial<Anexo>) => persistAnexos(anexos.map((x, j) => (j === i ? { ...x, ...p } : x)))
                    const semArquivo = !a.url
                    return (
                      <li key={i} className={cn('rounded-lg px-3 py-2', semArquivo ? 'bg-white border border-dashed border-gray-300' : 'bg-gray-50')}>
                        <div className="flex items-center gap-2">
                          <FileText className={cn('w-4 h-4 shrink-0', semArquivo ? 'text-gray-300' : 'text-orange-600')} />
                          <span className="text-[10px] font-medium text-gray-500 bg-gray-200 rounded px-1.5 py-0.5 shrink-0">{a.tipo}</span>
                          {semArquivo ? (
                            <>
                              <span className="flex-1 min-w-0 text-sm text-gray-400 italic truncate">aguardando o arquivo</span>
                              <button type="button" onClick={() => { anexoAlvo.current = i; fileRef.current?.click() }} disabled={uploading}
                                className="text-xs font-medium text-orange-600 hover:text-orange-700 shrink-0 disabled:opacity-50">anexar</button>
                            </>
                          ) : (
                            <a href={a.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 text-sm text-gray-700 truncate hover:text-orange-600 inline-flex items-center gap-1">
                              <span className="truncate">{a.nome}</span><ExternalLink className="w-3 h-3 opacity-50 shrink-0" />
                            </a>
                          )}
                          <button type="button" onClick={() => persistAnexos(anexos.filter((_, j) => j !== i))} aria-label="Remover"
                            className="text-gray-400 hover:text-red-500 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                        {/* Número e emitente: é por eles que se procura o documento depois. */}
                        <div className="flex items-center gap-2 mt-1.5 pl-6">
                          <input value={a.numero ?? ''} onChange={e => patch({ numero: e.target.value })}
                            placeholder="nº do documento" inputMode="numeric"
                            className="w-32 h-7 px-2 text-xs bg-white border border-gray-200 rounded-md focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none" />
                          <div className="w-36"><Select size="sm" value={a.emitente ?? ''} onChange={v => patch({ emitente: v })} options={[...EMITENTES]} /></div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
            <button type="submit" disabled={isPending}
              className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Salvar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/**
 * Edição em lote. Só entra o campo que a pessoa marcar — o resto fica intacto,
 * senão um "—" acidental limparia a categoria de 40 lançamentos de uma vez.
 * Por isso cada campo tem um checkbox de "aplicar", e não só um valor.
 */
function LoteModal({ orgSlug, ids, contas, categorias, centros, direcao, onClose, onDone }: {
  orgSlug: string; ids: string[]; contas: ContaRef[]
  categorias: FinanceCategoriaGrupo[]; centros: FinanceCentro[]
  /** entrada | saida quando o lote é homogêneo; null quando mistura os dois. */
  direcao: 'entrada' | 'saida' | null
  onClose: () => void; onDone: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [erro, setErro] = useState('')
  const [aplicar, setAplicar] = useState<Record<string, boolean>>({})
  const [val, setVal] = useState<Record<string, string>>({})

  const contaOptions = useMemo(() => [{ value: '', label: '—' }, ...contas.map(c => ({ value: c.id, label: c.nome }))], [contas])
  const centroOptions = useMemo(() => [{ value: '', label: '—' },
    ...centros.filter(c => !c.arquivado).map(c => ({ value: c.nome, label: c.nome }))], [centros])
  // Receita não pode receber categoria de custo (e vice-versa) — só as marcadas
  // como 'ambos' servem aos dois. Antes o lote oferecia TODAS, e classificar uma
  // receita como "Aluguel" corromperia justamente os gráficos de receita x custo.
  // Lote misturando entradas e saídas: só sobram as 'ambos'.
  const catOptions = useMemo(() => {
    const nomes = direcao
      ? categoriaNomes(categorias, direcao)
      : categoriaNomes(categorias, 'entrada').filter(n => categoriaNomes(categorias, 'saida').includes(n))
    return [{ value: '', label: '—' }, ...nomes.map(n => ({ value: n, label: n }))]
  }, [categorias, direcao])

  const campos: { key: string; label: string; options: { value: string; label: string }[] }[] = [
    { key: 'conta_id', label: 'Conta bancária', options: contaOptions },
    { key: 'categoria', label: 'Categoria', options: catOptions },
    { key: 'centro_custo', label: 'Centro de custo', options: centroOptions },
    { key: 'forma_pagamento', label: 'Forma de pagamento', options: FORMA_OPTIONS },
    { key: 'nf_emitida', label: 'NF emitida', options: [{ value: 'true', label: 'Sim' }, { value: 'false', label: 'Não' }] },
    { key: 'boleto_gerado', label: 'Boleto gerado', options: [{ value: 'true', label: 'Sim' }, { value: 'false', label: 'Não' }] },
  ]
  const marcados = campos.filter(c => aplicar[c.key])

  function salvar() {
    setErro('')
    const data: Record<string, unknown> = {}
    for (const c of marcados) {
      const v = val[c.key] ?? ''
      data[c.key] = (c.key === 'nf_emitida' || c.key === 'boleto_gerado') ? v === 'true' : v
    }
    startTransition(async () => {
      const r = await updateLancamentosLote(orgSlug, ids, data)
      if (r?.error) { setErro(r.error); return }
      const res = r?.result
      if (res?.bloqueados) {
        toast.success(`${res.atualizados} atualizado(s). ${res.bloqueados} pulado(s) por já estarem conciliados.`)
      } else {
        toast.success(`${res?.atualizados ?? 0} lançamento(s) atualizado(s).`)
      }
      onDone(); router.refresh()
    })
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="modal-card w-full max-w-lg bg-white rounded-2xl shadow-xl border border-gray-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Editar {ids.length} lançamento{ids.length > 1 ? 's' : ''}</h2>
          <button aria-label="Fechar" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-6 py-5">
      <p className="text-xs text-gray-500 mb-4">
        Marque só o que quer alterar. O que ficar desmarcado permanece como está em cada lançamento.
        Vencimento, valor e contato não entram em lote — são únicos por linha.
      </p>

      <div className="space-y-3">
        {campos.map(c => (
          <div key={c.key} className="flex items-center gap-3">
            <input type="checkbox" checked={!!aplicar[c.key]}
              onChange={() => setAplicar(a => ({ ...a, [c.key]: !a[c.key] }))}
              className="w-4 h-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500 cursor-pointer shrink-0" />
            <span className={cn('text-sm w-40 shrink-0', aplicar[c.key] ? 'text-gray-900' : 'text-gray-400')}>{c.label}</span>
            {/* Select não tem prop disabled — o wrapper corta o ponteiro e esmaece,
                deixando claro que o campo só vale se estiver marcado. */}
            <div className={cn('flex-1', !aplicar[c.key] && 'opacity-40 pointer-events-none')}>
              <Select value={val[c.key] ?? ''} onChange={v => setVal(s => ({ ...s, [c.key]: v }))}
                options={c.options} placeholder="—" />
            </div>
          </div>
        ))}
      </div>

      {erro && <p className="text-sm text-red-600 mt-4">{erro}</p>}

      <div className="flex items-center justify-end gap-2 mt-6">
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition">Cancelar</button>
        <button onClick={salvar} disabled={isPending || marcados.length === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Aplicar a {ids.length}
        </button>
      </div>
        </div>
      </div>
    </div>
  )
}

function BaixaModal({ orgSlug, lancamento, contas, onClose }: {
  orgSlug: string; lancamento: Lancamento; contas: ContaRef[]; onClose: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const isSaida = lancamento.tipo === 'saida'
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({
    data_liquidacao: today,
    conta_id: lancamento.conta_id ?? '',
    forma_pagamento: lancamento.forma_pagamento ?? '',
    juros: '', multa: '', desconto: '', tarifa: '',
  })

  const base = val(lancamento)
  const total = base + Number(parseBR(form.juros)) + Number(parseBR(form.multa)) - Number(parseBR(form.desconto)) - Number(parseBR(form.tarifa))
  const contaOptions = useMemo(() => [{ value: '', label: '—' }, ...contas.map(c => ({ value: c.id, label: c.nome }))], [contas])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const data = {
      data_liquidacao: form.data_liquidacao || null,
      conta_id: form.conta_id || null,
      forma_pagamento: form.forma_pagamento || null,
      juros: parseBR(form.juros), multa: parseBR(form.multa),
      desconto: parseBR(form.desconto), tarifa: parseBR(form.tarifa),
      valor_realizado: String(total),
    }
    startTransition(async () => {
      const res = await liquidarLancamento(orgSlug, lancamento.id, data)
      if (res?.error) { setError(res.error); return }
      onClose(); router.refresh()
    })
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="modal-card w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{isSaida ? 'Pagar' : 'Receber'} — {formatBRL(base)}</h2>
          <button aria-label="Fechar" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          {lancamento.descricao && <p className="text-sm text-gray-500">{lancamento.contato_nome ? `${lancamento.contato_nome} · ` : ''}{lancamento.descricao}</p>}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Data {isSaida ? 'do pagamento' : 'do recebimento'}</label>
              <input type="date" value={form.data_liquidacao} onChange={e => setForm(f => ({ ...f, data_liquidacao: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Conta</label>
              <Select value={form.conta_id} onChange={v => setForm(f => ({ ...f, conta_id: v }))} options={contaOptions} placeholder="—" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Juros</label>
              <input type="text" inputMode="decimal" value={form.juros} onChange={e => setForm(f => ({ ...f, juros: e.target.value }))} placeholder="0,00" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Multa</label>
              <input type="text" inputMode="decimal" value={form.multa} onChange={e => setForm(f => ({ ...f, multa: e.target.value }))} placeholder="0,00" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Desconto</label>
              <input type="text" inputMode="decimal" value={form.desconto} onChange={e => setForm(f => ({ ...f, desconto: e.target.value }))} placeholder="0,00" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Tarifa</label>
              <input type="text" inputMode="decimal" value={form.tarifa} onChange={e => setForm(f => ({ ...f, tarifa: e.target.value }))} placeholder="0,00" className={inputCls} />
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-gray-100 pt-3">
            <span className="text-sm text-gray-500">Total {isSaida ? 'pago' : 'recebido'}</span>
            <span className="text-base font-semibold text-gray-900">{formatBRL(total)}</span>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
            <button type="submit" disabled={isPending}
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Confirmar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
