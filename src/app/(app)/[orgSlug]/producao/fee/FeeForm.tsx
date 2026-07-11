'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { formatBRL, parseMoney } from '@/lib/midia'
import type { ClienteOpt, MemberOpt } from '../../midias/simplificada/MidiaForm'

export interface ParcelaFee { vencimento: string; valor: string; tipo: string }
export interface FeeValues {
  workspace_id: string; titulo: string
  de: string; ate: string; num_parcelas: string; valor_mensal: string
  contato: string; responsavel_id: string; situacao: string; observacao: string; texto_legal: string
  parcelas: ParcelaFee[]
}

const inputCls = 'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'
const cardCls = 'bg-white rounded-2xl border border-gray-200 p-5'

function addMonths(iso: string, k: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1 + k, d))
  return dt.toISOString().slice(0, 10)
}
function addDays(iso: string, k: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + k))
  return dt.toISOString().slice(0, 10)
}
// Fim proposto do contrato: 1 ano após o início, menos 1 dia (ex.: 06/07/26 → 05/07/27).
function oneYearEnd(de: string): string {
  return de ? addDays(addMonths(de, 12), -1) : ''
}
function emptyValues(today: string, responsavelId: string): FeeValues {
  return {
    workspace_id: '', titulo: '', de: today, ate: '', num_parcelas: '12', valor_mensal: '',
    contato: '', responsavel_id: responsavelId, situacao: 'em_aberto', observacao: '', texto_legal: '',
    parcelas: [],
  }
}

export function FeeForm({
  clientes, members, defaultResponsavelId, today, redirectTo, initial, submitLabel = 'Gravar', defaultObservacao = '', onSubmit,
}: {
  clientes: ClienteOpt[]; members: MemberOpt[]
  defaultResponsavelId: string; today: string; redirectTo: string
  initial?: Partial<FeeValues>; submitLabel?: string
  /** Observação padrão da org (Configurações → Documentos) — pré-carregada como "conhecimento". */
  defaultObservacao?: string
  onSubmit: (fd: FormData) => Promise<{ error?: string } | void>
}) {
  const router = useRouter()
  // Fee novo herda a observação padrão da config; edição mantém a salva.
  const initialObs = initial?.observacao ?? defaultObservacao
  const [form, setForm] = useState<FeeValues>({ ...emptyValues(today, defaultResponsavelId), ...initial, observacao: initialObs, parcelas: initial?.parcelas ?? [] })
  // Modo "conhecimento" (só leitura) quando a observação é exatamente o texto padrão;
  // some quando não há padrão configurado ou o usuário já customizou.
  const [editObs, setEditObs] = useState(() => !defaultObservacao || initialObs !== defaultObservacao)
  const [primeira, setPrimeira] = useState(initial?.parcelas?.[0]?.vencimento || today)
  const [isPending, startTransition] = useTransition()
  const [running, setRunning] = useState<'save' | 'approve' | null>(null)
  const [error, setError] = useState('')

  function set<K extends keyof FeeValues>(k: K, v: FeeValues[K]) { setForm(f => ({ ...f, [k]: v })) }
  const setParc = (i: number, k: keyof ParcelaFee, v: string) => setForm(f => ({ ...f, parcelas: f.parcelas.map((p, idx) => idx === i ? { ...p, [k]: v } : p) }))
  const addParc = () => setForm(f => ({ ...f, parcelas: [...f.parcelas, { vencimento: primeira, valor: f.valor_mensal, tipo: 'receber_cliente' }] }))
  const delParc = (i: number) => setForm(f => ({ ...f, parcelas: f.parcelas.filter((_, idx) => idx !== i) }))

  function gerarAutomaticas() {
    const n = parseInt(form.num_parcelas || '0', 10) || 0
    const ps: ParcelaFee[] = []
    for (let k = 0; k < n; k++) ps.push({ vencimento: addMonths(primeira, k), valor: form.valor_mensal, tipo: 'receber_cliente' })
    setForm(f => ({ ...f, parcelas: ps }))
  }

  const total = useMemo(() => form.parcelas.reduce((s, p) => s + parseMoney(p.valor), 0), [form.parcelas])
  const cliNome = clientes.find(c => c.id === form.workspace_id)?.name
  const PARCELA_TIPOS = [{ value: 'receber_cliente', label: `Receber do Cliente${cliNome ? ` (${cliNome})` : ''}` }]

  // situacaoAlvo: 'em_aberto' salva rascunho; 'aprovado' aprova e já fatura
  // (a RPC gera os lançamentos das parcelas). Em edição, undefined mantém a atual.
  function handleSubmit(e: React.FormEvent, situacaoAlvo?: string) {
    e.preventDefault()
    setError('')
    if (!form.workspace_id) { setError('Selecione o cliente'); return }
    if (!form.titulo.trim()) { setError('Informe o título'); return }
    if (situacaoAlvo === 'aprovado' && form.parcelas.length === 0) {
      setError('Gere as parcelas antes de aprovar (é o que vira o faturamento).'); return
    }

    const fd = new FormData()
    fd.set('tipo', 'fee')
    fd.set('workspace_id', form.workspace_id)
    fd.set('titulo', form.titulo)
    fd.set('emissao', form.de || today)
    fd.set('situacao', situacaoAlvo ?? form.situacao)
    fd.set('observacao', form.observacao)
    fd.set('texto_legal', form.texto_legal)
    fd.set('contato', form.contato)
    fd.set('responsavel_id', form.responsavel_id)
    fd.set('valor', String(total))
    fd.set('redirect_to', redirectTo)
    const parcelas = form.parcelas.map(p => ({ vencimento: p.vencimento, valor: String(parseMoney(p.valor)), tipo: 'receber_cliente' }))
    fd.set('detalhe', JSON.stringify({ de: form.de, ate: form.ate, num_parcelas: form.num_parcelas, valor_mensal: form.valor_mensal, parcelas }))

    setRunning(situacaoAlvo === 'aprovado' ? 'approve' : 'save')
    startTransition(async () => {
      const res = await onSubmit(fd)
      if (res?.error) { setError(res.error); setRunning(null); return }
    })
  }

  const clienteOptions = clientes.map(c => ({ value: c.id, label: c.name }))
  const memberOptions = members.map(m => ({ value: m.id, label: m.name }))

  return (
    <div className="p-6 max-w-4xl">
      <button onClick={() => router.back()} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition mb-4">
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>
      <h1 className="text-xl font-semibold text-gray-900 mb-5">{submitLabel === 'Gravar' ? 'Adicionar' : 'Editar'} Fee</h1>

      <form onSubmit={e => handleSubmit(e)} className="space-y-5">
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className={cardCls}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className={labelCls}>Cliente <span className="text-red-500">*</span></label>
              <Select value={form.workspace_id} onChange={v => set('workspace_id', v)} options={clienteOptions} placeholder="Selecionar cliente" /></div>
            <div><label className={labelCls}>Título <span className="text-red-500">*</span></label>
              <input value={form.titulo} onChange={e => set('titulo', e.target.value)} className={inputCls} required /></div>
          </div>
        </div>

        <div className={cardCls}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div><label className={labelCls}>De</label><input type="date" value={form.de} onChange={e => setForm(f => ({ ...f, de: e.target.value, ate: oneYearEnd(e.target.value) }))} className={inputCls} /></div>
            <div><label className={labelCls}>Até</label><input type="date" value={form.ate} onChange={e => set('ate', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Parcelas</label><input value={form.num_parcelas} onChange={e => set('num_parcelas', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Valor mensal (R$)</label><input inputMode="decimal" value={form.valor_mensal} onChange={e => set('valor_mensal', e.target.value)} placeholder="0,00" className={inputCls} /></div>
          </div>
        </div>

        {/* Parcelas */}
        <div className={cardCls}>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Parcelas (cobrança mensal)</h3>
            <div className="flex items-end gap-2">
              <div><label className={labelCls}>1ª cobrança</label><input type="date" value={primeira} onChange={e => setPrimeira(e.target.value)} className={cn(inputCls, 'w-40')} /></div>
              <button type="button" onClick={gerarAutomaticas} className="inline-flex items-center gap-1.5 px-2.5 py-2.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition">Gerar automáticas</button>
              <button aria-label="Adicionar" type="button" onClick={addParc} className="inline-flex items-center gap-1.5 px-2.5 py-2.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"><Plus className="w-3.5 h-3.5" /></button>
            </div>
          </div>
          {form.parcelas.length === 0 ? (
            <p className="text-sm text-gray-400">Preencha nº de parcelas + valor mensal, escolha a 1ª cobrança e clique em “Gerar automáticas”.</p>
          ) : (
            <div className="space-y-2">
              {form.parcelas.map((p, i) => (
                <div key={i} className="flex flex-col sm:flex-row gap-2 sm:items-center">
                  <input type="date" value={p.vencimento} onChange={e => setParc(i, 'vencimento', e.target.value)} className={cn(inputCls, 'sm:w-44')} />
                  <input inputMode="decimal" value={p.valor} onChange={e => setParc(i, 'valor', e.target.value)} placeholder="0,00" className={cn(inputCls, 'sm:w-40 text-right')} />
                  <div className="flex-1"><Select value={p.tipo} onChange={v => setParc(i, 'tipo', v)} options={PARCELA_TIPOS} /></div>
                  <button aria-label="Remover" type="button" onClick={() => delParc(i)} className="text-gray-300 hover:text-red-500 transition shrink-0 self-center"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              <div className="flex justify-end pt-2 text-sm"><span className="text-gray-500">Total do contrato:&nbsp;</span><span className="font-semibold text-gray-900">{formatBRL(total)}</span></div>
            </div>
          )}
        </div>

        <div className={cardCls}>
          <div className="flex items-center justify-between mb-1">
            <label className={cn(labelCls, 'mb-0')}>Observação</label>
            {!editObs && (
              <button type="button" onClick={() => setEditObs(true)} className="inline-flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-700 transition-colors">
                <Pencil className="w-3 h-3" /> Editar
              </button>
            )}
          </div>
          {editObs ? (
            <textarea rows={3} value={form.observacao} onChange={e => set('observacao', e.target.value)} className={cn(inputCls, 'resize-none')} />
          ) : (
            <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5 text-sm text-gray-500 whitespace-pre-line">
              {form.observacao}
              <p className="mt-1.5 text-[11px] text-gray-400">Texto padrão de Configurações → Documentos. Clique em “Editar” para personalizar só deste Fee.</p>
            </div>
          )}
          <label className={cn(labelCls, 'mt-4')}>Texto Legal</label>
          <textarea rows={2} value={form.texto_legal} onChange={e => set('texto_legal', e.target.value)} className={cn(inputCls, 'resize-none')} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <div><label className={labelCls}>Contato</label><input value={form.contato} onChange={e => set('contato', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Responsável</label><Select value={form.responsavel_id} onChange={v => set('responsavel_id', v)} options={memberOptions} placeholder="Selecionar" /></div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:justify-end gap-2 pb-10">
          <button type="button" onClick={() => router.back()} className="px-4 py-2.5 text-sm text-gray-500 hover:text-gray-700 transition order-last sm:order-first">Cancelar</button>
          {/* Gravar = rascunho (Em Aberto). Aprovar e faturar = gera as parcelas em Lançamentos. */}
          <button aria-label="Gravar rascunho" type="submit" disabled={isPending}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 disabled:opacity-50 transition">
            {isPending && running === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}Gravar
          </button>
          <button aria-label="Aprovar e faturar" type="button" onClick={e => handleSubmit(e, 'aprovado')} disabled={isPending}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            {isPending && running === 'approve' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}Aprovar e faturar
          </button>
        </div>
      </form>
    </div>
  )
}
