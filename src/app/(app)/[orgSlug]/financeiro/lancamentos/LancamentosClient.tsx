'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, FileText, Receipt, Check, RotateCcw, AlertTriangle, RefreshCw, Plus, X, Loader2, Pencil, Trash2, ArrowDownCircle, ArrowUpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBRL, formatDateBR } from '@/lib/midia'
import { Select } from '@/components/ui/Select'
import {
  setLancamentoFlags, ressincronizarLancamento, marcarLancamentoRevisado,
  createLancamento, updateLancamento, deleteLancamento, liquidarLancamento, reabrirLancamento,
  type FinanceCategoriaGrupo, type FinanceCentro,
} from '@/app/actions/financeiro'

export interface Lancamento {
  id: string
  tipo: string                      // entrada | saida
  origem_tipo: string | null        // midia | producao | fee | manual
  contato_nome: string | null
  descricao: string | null
  valor: number | string
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
}

export interface ContaRef { id: string; nome: string; cor: string | null; ativo: boolean }

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
const signed = (l: Lancamento) => (l.tipo === 'saida' ? -val(l) : val(l))
/** "1.234,56" → "1234.56" (string p/ a RPC). Vazio → '0'. */
const parseBR = (s: string) => { const t = s.trim().replace(/\./g, '').replace(',', '.'); return t === '' ? '0' : t }
const inputCls = 'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

export function LancamentosClient({ orgSlug, lancamentos, contas, categorias, centros, today }: {
  orgSlug: string; lancamentos: Lancamento[]; contas: ContaRef[]
  categorias: FinanceCategoriaGrupo[]; centros: FinanceCentro[]; today: string
}) {
  const [mes, setMes] = useState(today.slice(0, 7))
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Lancamento | null>(null)
  const [baixa, setBaixa] = useState<Lancamento | null>(null)

  const { atrasado, aVencer, pagos } = useMemo(() => {
    const atrasado = lancamentos.filter(l => !isPago(l.situacao) && l.vencimento && l.vencimento < today)
    const aVencer = lancamentos.filter(l => !isPago(l.situacao) && (!l.vencimento || (monthOf(l.vencimento) === mes && l.vencimento >= today)))
    const pagos = lancamentos.filter(l => isPago(l.situacao) && monthOf(l.vencimento) === mes)
    return { atrasado, aVencer, pagos }
  }, [lancamentos, mes, today])

  const sum = (arr: Lancamento[]) => arr.reduce((s, l) => s + signed(l), 0)
  const revisarCount = lancamentos.filter(l => l.revisar).length

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Lançamentos</h1>
          <p className="text-gray-500 text-sm mt-0.5">Controle mensal — a receber, a pagar, NF e boleto</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5">
            <button onClick={() => setMes(m => shiftMonth(m, -1))} className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition"><ChevronLeft className="w-4 h-4" /></button>
            <span className="px-3 text-sm font-medium text-gray-800 min-w-[120px] text-center">{monthLabel(mes)}</span>
            <button onClick={() => setMes(m => shiftMonth(m, 1))} className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition"><ChevronRight className="w-4 h-4" /></button>
          </div>
          <button onClick={() => setCreating(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 transition">
            <Plus className="w-4 h-4" /> Nova
          </button>
        </div>
      </div>

      {revisarCount > 0 && (
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span><strong>{revisarCount}</strong> lançamento(s) com o documento alterado depois de lançado — revise (atualizar do documento ou marcar revisado).</span>
        </div>
      )}

      <Bucket title="Atrasado" tone="red" total={sum(atrasado)} items={atrasado} orgSlug={orgSlug} today={today}
        emptyHint="Nada atrasado." contas={contas} onEdit={setEditing} onBaixa={setBaixa} />
      <Bucket title={`A vencer em ${monthLabel(mes)}`} tone="amber" total={sum(aVencer)} items={aVencer} orgSlug={orgSlug} today={today}
        emptyHint="Nada a vencer neste mês." contas={contas} onEdit={setEditing} onBaixa={setBaixa} />
      <Bucket title={`Realizado em ${monthLabel(mes)}`} tone="emerald" total={sum(pagos)} items={pagos} orgSlug={orgSlug} today={today}
        emptyHint="Nada realizado neste mês." contas={contas} onEdit={setEditing} onBaixa={setBaixa} paid />

      {(creating || editing) && (
        <LancamentoModal orgSlug={orgSlug} lancamento={editing} contas={contas} categorias={categorias} centros={centros}
          onClose={() => { setCreating(false); setEditing(null) }} />
      )}
      {baixa && (
        <BaixaModal orgSlug={orgSlug} lancamento={baixa} contas={contas} onClose={() => setBaixa(null)} />
      )}
    </div>
  )
}

function Bucket({ title, tone, total, items, orgSlug, today, emptyHint, contas, onEdit, onBaixa, paid = false }: {
  title: string; tone: 'red' | 'amber' | 'emerald'; total: number; items: Lancamento[]
  orgSlug: string; today: string; emptyHint: string; contas: ContaRef[]
  onEdit: (l: Lancamento) => void; onBaixa: (l: Lancamento) => void; paid?: boolean
}) {
  const toneCls = {
    red: 'text-red-700 bg-red-50 border-red-100',
    amber: 'text-amber-700 bg-amber-50 border-amber-100',
    emerald: 'text-emerald-700 bg-emerald-50 border-emerald-100',
  }[tone]
  const contaMap = useMemo(() => Object.fromEntries(contas.map(c => [c.id, c])), [contas])

  return (
    <div className="mb-5">
      <div className={cn('flex items-center justify-between px-4 py-2 rounded-t-xl border text-sm font-semibold', toneCls)}>
        <span>{title} · {items.length}</span>
        <span>{formatBRL(total)}</span>
      </div>
      <div className="bg-white rounded-b-xl border border-t-0 border-gray-200 overflow-hidden overflow-x-auto">
        {items.length > 0 ? (
          <table className="w-full min-w-[820px]">
            <thead>
              <tr className="border-b border-gray-100 text-xs font-medium text-gray-400">
                <th className="text-left px-4 py-2">{paid ? 'Liquidação' : 'Vencimento'}</th>
                <th className="text-left px-4 py-2">Contato</th>
                <th className="text-left px-4 py-2">Descrição</th>
                <th className="text-right px-4 py-2">Valor</th>
                <th className="text-center px-3 py-2">NF</th>
                <th className="text-center px-3 py-2">Boleto</th>
                <th className="w-40" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map(l => <Row key={l.id} l={l} orgSlug={orgSlug} today={today} paid={paid} conta={l.conta_id ? contaMap[l.conta_id] : undefined} onEdit={onEdit} onBaixa={onBaixa} />)}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-400 px-4 py-5">{emptyHint}</p>
        )}
      </div>
    </div>
  )
}

function Row({ l, orgSlug, today, paid, conta, onEdit, onBaixa }: {
  l: Lancamento; orgSlug: string; today: string; paid: boolean; conta?: ContaRef
  onEdit: (l: Lancamento) => void; onBaixa: (l: Lancamento) => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const overdue = !paid && !!l.vencimento && l.vencimento < today
  const isSaida = l.tipo === 'saida'
  const isManual = l.origem_tipo === 'manual'
  const dateShown = paid ? (l.data_liquidacao ?? l.vencimento) : l.vencimento

  function toggleNf() { startTransition(async () => { await setLancamentoFlags(orgSlug, l.id, !l.nf_emitida, l.boleto_gerado); router.refresh() }) }
  function toggleBoleto() { startTransition(async () => { await setLancamentoFlags(orgSlug, l.id, l.nf_emitida, !l.boleto_gerado); router.refresh() }) }
  function reabrir() { startTransition(async () => { await reabrirLancamento(orgSlug, l.id); router.refresh() }) }
  function atualizarDoDoc() { startTransition(async () => { await ressincronizarLancamento(orgSlug, l.id); router.refresh() }) }
  function marcarRevisado() { startTransition(async () => { await marcarLancamentoRevisado(orgSlug, l.id); router.refresh() }) }
  function remover() {
    if (!confirm('Excluir este lançamento manual?')) return
    startTransition(async () => { await deleteLancamento(orgSlug, l.id); router.refresh() })
  }

  return (
    <tr className={cn('transition', isPending ? 'opacity-50' : 'hover:bg-gray-50/50', l.revisar && 'bg-amber-50/40')}>
      <td className={cn('px-4 py-2.5 text-sm', overdue ? 'text-red-600 font-medium' : 'text-gray-600')}>{formatDateBR(dateShown)}</td>
      <td className="px-4 py-2.5 text-sm text-gray-900">
        <div className="flex items-center gap-1.5">
          {isSaida ? <ArrowUpCircle className="w-3.5 h-3.5 text-red-400 shrink-0" /> : <ArrowDownCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
          <span>{l.contato_nome ?? '—'}</span>
          {l.revisar && <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 text-[10px] font-medium px-1.5 py-0.5"><AlertTriangle className="w-2.5 h-2.5" /> alterado</span>}
        </div>
      </td>
      <td className="px-4 py-2.5 text-sm text-gray-600">
        <span>{l.descricao ?? '—'}</span>
        {(l.categoria || conta) && (
          <span className="ml-2 inline-flex items-center gap-1.5 align-middle">
            {l.categoria && <span className="text-[10px] text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">{l.categoria}</span>}
            {conta && <span className="inline-flex items-center gap-1 text-[10px] text-gray-500"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: conta.cor ?? '#cbd5e1' }} />{conta.nome}</span>}
          </span>
        )}
      </td>
      <td className={cn('px-4 py-2.5 text-sm font-medium text-right', isSaida ? 'text-red-600' : 'text-gray-900')}>
        {isSaida ? '− ' : ''}{formatBRL(val(l))}
      </td>
      <td className="px-3 py-2.5 text-center"><Flag on={l.nf_emitida} onClick={toggleNf} label="NF" /></td>
      <td className="px-3 py-2.5 text-center"><Flag on={l.boleto_gerado} onClick={toggleBoleto} label="Boleto" /></td>
      <td className="px-3 py-2.5">
        <div className="flex items-center justify-end gap-1">
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
          <button onClick={() => onEdit(l)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition" title="Editar"><Pencil className="w-3.5 h-3.5" /></button>
          {isManual && (
            <button onClick={remover} disabled={isPending} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition disabled:opacity-50" title="Excluir"><Trash2 className="w-3.5 h-3.5" /></button>
          )}
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

function LancamentoModal({ orgSlug, lancamento, contas, categorias, centros, onClose }: {
  orgSlug: string; lancamento: Lancamento | null; contas: ContaRef[]
  categorias: FinanceCategoriaGrupo[]; centros: FinanceCentro[]; onClose: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const readonly = !!lancamento && lancamento.origem_tipo !== 'manual'
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
    const opts: { value: string; label: string }[] = [{ value: '', label: '—' }]
    for (const g of categorias) {
      if (g.tipo !== form.tipo) continue
      if (g.filhos.length === 0) opts.push({ value: g.nome, label: g.nome })
      else for (const f of g.filhos) opts.push({ value: f.nome, label: f.nome })
    }
    return opts
  }, [categorias, form.tipo])
  const contaOptions = useMemo(() => [{ value: '', label: '—' }, ...contas.map(c => ({ value: c.id, label: c.nome }))], [contas])
  const centroOptions = useMemo(() => [{ value: '', label: '—' }, ...centros.map(c => ({ value: c.nome, label: c.nome }))], [centros])

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
      observacao: form.observacao.trim() || null,
    }
    startTransition(async () => {
      const res = lancamento
        ? await updateLancamento(orgSlug, lancamento.id, data)
        : await createLancamento(orgSlug, data)
      if (res?.error) { setError(res.error); return }
      onClose(); router.refresh()
    })
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="modal-card w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-xl border border-gray-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h2 className="text-base font-semibold text-gray-900">{lancamento ? 'Editar lançamento' : 'Novo lançamento'}</h2>
          <button aria-label="Fechar" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          {readonly && <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">Lançamento gerado por documento ({lancamento?.origem_tipo}). Valor e contato vêm do documento; aqui você ajusta os campos do financeiro.</p>}

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
              <label className={labelCls}>Vencimento</label>
              <input type="date" value={form.vencimento} onChange={e => setForm(f => ({ ...f, vencimento: e.target.value }))} className={inputCls} />
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
