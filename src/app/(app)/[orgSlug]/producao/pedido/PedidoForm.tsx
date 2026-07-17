'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, Loader2, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { Combobox } from '@/components/ui/Combobox'
import { MIDIA_SITUACAO_OPTIONS, MIDIA_PRAZO_OPTIONS, formatBRL, parseMoney } from '@/lib/midia'
import type { ClienteOpt, MemberOpt } from '../../midias/simplificada/MidiaForm'
import type { FornecedorOpt } from '@/lib/midia-selectors'

export interface ItemPed { nome: string; descricao: string; n_orc: string; quant: string; valor: string }
export interface Parcela { vencimento: string; valor: string; tipo: string }
export interface PedidoValues {
  workspace_id: string; campaign_id: string; fornecedor_id: string; titulo: string
  emissao: string; entrega: string
  faturar: string; bv_pct: string; honorarios_pct: string; prazo: string; dias_agencia: string
  contato: string; responsavel_id: string; situacao: string; observacao: string; texto_legal: string
  itens: ItemPed[]; parcelas: Parcela[]
}

const FATURAR = [{ value: 'contra_cliente', label: 'Contra o Cliente' }, { value: 'contra_agencia', label: 'Contra a Agência' }]
const inputCls = 'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent'
const cellCls = 'w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'
const cardCls = 'bg-white rounded-2xl border border-gray-200 p-5'

const newItem = (): ItemPed => ({ nome: '', descricao: '', n_orc: '', quant: '1', valor: '' })
const newParcela = (tipo = 'cliente_paga_fornecedor', venc = '', valor = ''): Parcela => ({ vencimento: venc, valor, tipo })
const itemTotal = (it: ItemPed) => (parseInt(it.quant || '1', 10) || 0) * parseMoney(it.valor)

function emptyValues(today: string, responsavelId: string): PedidoValues {
  return {
    workspace_id: '', campaign_id: '', fornecedor_id: '', titulo: '',
    emissao: today, entrega: '',
    faturar: 'contra_cliente', bv_pct: '15', honorarios_pct: '0', prazo: 'a_vista', dias_agencia: '7',
    contato: '', responsavel_id: responsavelId, situacao: 'em_aberto', observacao: '', texto_legal: '',
    itens: [newItem()], parcelas: [],
  }
}

export function PedidoForm({
  clientes, fornecedores, members, defaultResponsavelId, today, redirectTo, initial, submitLabel = 'Gravar', onSubmit,
}: {
  clientes: ClienteOpt[]; fornecedores: FornecedorOpt[]; members: MemberOpt[]
  defaultResponsavelId: string; today: string; redirectTo: string
  initial?: Partial<PedidoValues>; submitLabel?: string
  onSubmit: (fd: FormData) => Promise<{ error?: string } | void>
}) {
  const router = useRouter()
  const [form, setForm] = useState<PedidoValues>({
    ...emptyValues(today, defaultResponsavelId), ...initial,
    itens: initial?.itens?.length ? initial.itens : [newItem()],
    parcelas: initial?.parcelas ?? [],
  })
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function set<K extends keyof PedidoValues>(k: K, v: PedidoValues[K]) { setForm(f => ({ ...f, [k]: v })) }
  const setItem = (i: number, k: keyof ItemPed, v: string) => setForm(f => ({ ...f, itens: f.itens.map((it, idx) => idx === i ? { ...it, [k]: v } : it) }))
  const addItem = () => setForm(f => ({ ...f, itens: [...f.itens, newItem()] }))
  const delItem = (i: number) => setForm(f => ({ ...f, itens: f.itens.filter((_, idx) => idx !== i) }))
  const setParc = (i: number, k: keyof Parcela, v: string) => setForm(f => ({ ...f, parcelas: f.parcelas.map((p, idx) => idx === i ? { ...p, [k]: v } : p) }))
  const addParc = () => setForm(f => ({ ...f, parcelas: [...f.parcelas, newParcela('cliente_paga_fornecedor', f.emissao)] }))
  const delParc = (i: number) => setForm(f => ({ ...f, parcelas: f.parcelas.filter((_, idx) => idx !== i) }))

  const valorTotal = useMemo(() => form.itens.reduce((s, it) => s + itemTotal(it), 0), [form.itens])
  const bv = valorTotal * (parseMoney(form.bv_pct) / 100)
  const honorarios = valorTotal * (parseMoney(form.honorarios_pct) / 100)

  const fornNome = fornecedores.find(f => f.id === form.fornecedor_id)?.name
  const cliNome = clientes.find(c => c.id === form.workspace_id)?.name
  const PARCELA_TIPOS = [
    { value: 'cliente_paga_fornecedor', label: `Cliente paga ao Fornecedor${fornNome ? ` (${fornNome})` : ''}` },
    { value: 'receber_bv', label: `Receber Comissão do Fornecedor${fornNome ? ` (${fornNome})` : ''}` },
    { value: 'receber_honorarios', label: `Receber Honorários do Cliente${cliNome ? ` (${cliNome})` : ''}` },
  ]

  function gerarAutomaticas() {
    const ps: Parcela[] = []
    if (valorTotal > 0) ps.push(newParcela('cliente_paga_fornecedor', form.emissao, String(valorTotal)))
    if (bv > 0) ps.push(newParcela('receber_bv', form.emissao, String(bv)))
    if (honorarios > 0) ps.push(newParcela('receber_honorarios', form.emissao, String(honorarios)))
    setForm(f => ({ ...f, parcelas: ps }))
  }

  const campanhaOptions = useMemo(() => {
    const c = clientes.find(c => c.id === form.workspace_id)
    return (c?.campaigns ?? []).map(cp => ({ value: cp.id, label: cp.name }))
  }, [clientes, form.workspace_id])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.workspace_id) { setError('Selecione o cliente'); return }
    if (!form.fornecedor_id) { setError('Selecione o fornecedor'); return }
    if (!form.titulo.trim()) { setError('Informe o título'); return }

    const fd = new FormData()
    const scalars: (keyof PedidoValues)[] = ['workspace_id', 'campaign_id', 'titulo', 'faturar', 'emissao', 'contato', 'responsavel_id', 'situacao', 'observacao', 'texto_legal']
    scalars.forEach(k => fd.set(k, String(form[k] ?? '')))
    fd.set('tipo', 'pedido')
    fd.set('bv_pct', String(parseMoney(form.bv_pct)))
    fd.set('honorarios_pct', String(parseMoney(form.honorarios_pct)))
    fd.set('valor', String(valorTotal))
    fd.set('redirect_to', redirectTo)
    const parcelas = form.parcelas.map(p => ({ vencimento: p.vencimento, valor: String(parseMoney(p.valor)), tipo: p.tipo }))
    const diasAgencia = parseInt(form.dias_agencia || '7', 10) || 0
    fd.set('detalhe', JSON.stringify({ fornecedor_id: form.fornecedor_id, entrega: form.entrega, prazo: form.prazo, dias_agencia: diasAgencia, itens: form.itens, parcelas }))

    startTransition(async () => {
      const res = await onSubmit(fd)
      if (res?.error) { setError(res.error); return }
    })
  }

  const clienteOptions = clientes.map(c => ({ value: c.id, label: c.name }))
  const fornecedorOptions = fornecedores.map(f => ({ value: f.id, label: f.name }))
  const memberOptions = members.map(m => ({ value: m.id, label: m.name }))

  return (
    <div className="p-6 max-w-5xl">
      <button onClick={() => router.back()} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition mb-4">
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>
      <h1 className="text-xl font-semibold text-gray-900 mb-5">{submitLabel === 'Gravar' ? 'Adicionar' : 'Editar'} Pedido de Produção</h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        {/* Cabeçalho */}
        <div className={cardCls}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div><label className={labelCls}>Cliente <span className="text-red-500">*</span></label>
              <Select value={form.workspace_id} onChange={v => setForm(f => ({ ...f, workspace_id: v, campaign_id: '' }))} options={clienteOptions} placeholder="Selecionar cliente" /></div>
            <div><label className={labelCls}>Campanha</label>
              <Select value={form.campaign_id} onChange={v => set('campaign_id', v)} options={campanhaOptions} placeholder={form.workspace_id ? 'Selecionar' : 'Escolha o cliente'} /></div>
            <div><label className={labelCls}>Fornecedor <span className="text-red-500">*</span></label>
              <Combobox value={form.fornecedor_id} onChange={v => set('fornecedor_id', v)} options={fornecedorOptions} placeholder="Buscar fornecedor" /></div>
            <div><label className={labelCls}>Emissão</label><input type="date" value={form.emissao} onChange={e => set('emissao', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Entrega</label><input type="date" value={form.entrega} onChange={e => set('entrega', e.target.value)} className={inputCls} /></div>
          </div>
          <div className="mt-4"><label className={labelCls}>Título <span className="text-red-500">*</span></label>
            <input value={form.titulo} onChange={e => set('titulo', e.target.value)} className={inputCls} required /></div>
        </div>

        {/* Itens */}
        <div className={cardCls}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Itens</h3>
            <button type="button" onClick={addItem} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"><Plus className="w-3.5 h-3.5" /> Adicionar</button>
          </div>
          <div className="space-y-4">
            {form.itens.map((it, i) => (
              <div key={i} className="border border-gray-100 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <input value={it.nome} onChange={e => setItem(i, 'nome', e.target.value)} placeholder="Item (ex.: FineArt, Vídeo)" className={cn(inputCls, 'font-medium')} />
                  {form.itens.length > 1 && <button aria-label="Remover" type="button" onClick={() => delItem(i)} className="text-gray-300 hover:text-red-500 transition shrink-0"><Trash2 className="w-4 h-4" /></button>}
                </div>
                <textarea rows={2} value={it.descricao} onChange={e => setItem(i, 'descricao', e.target.value)} placeholder="Descrição" className={cn(inputCls, 'resize-y min-h-[42px] mb-2')} />
                <div className="grid grid-cols-3 gap-3">
                  <div><label className={labelCls}>Nº Orç.</label><input value={it.n_orc} onChange={e => setItem(i, 'n_orc', e.target.value)} className={cellCls} /></div>
                  <div><label className={labelCls}>Quantidade</label><input value={it.quant} onChange={e => setItem(i, 'quant', e.target.value)} className={cn(cellCls, 'text-right')} /></div>
                  <div><label className={labelCls}>Valor (R$)</label><input inputMode="decimal" value={it.valor} onChange={e => setItem(i, 'valor', e.target.value)} placeholder="0,00" className={cn(cellCls, 'text-right')} /></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Faturamento */}
        <div className={cardCls}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
            <div><p className="text-xs text-gray-400">Valor Total</p><p className="text-lg font-semibold text-gray-900">{formatBRL(valorTotal)}</p></div>
            <div><label className={labelCls}>Faturar</label><Select value={form.faturar} onChange={v => set('faturar', v)} options={FATURAR} /></div>
            <div><label className={labelCls}>Prazo</label><Select value={form.prazo} onChange={v => set('prazo', v)} options={MIDIA_PRAZO_OPTIONS} /></div>
            <div><label className={labelCls}>Comissão (%)</label><input inputMode="decimal" value={form.bv_pct} onChange={e => set('bv_pct', e.target.value)} className={inputCls} /><p className="text-xs text-gray-400 mt-1">{formatBRL(bv)} — a receber do fornecedor</p></div>
            <div><label className={labelCls}>Honorários (%)</label><input inputMode="decimal" value={form.honorarios_pct} onChange={e => set('honorarios_pct', e.target.value)} className={inputCls} /><p className="text-xs text-gray-400 mt-1">{formatBRL(honorarios)} — a receber do cliente</p></div>
            <div><label className={labelCls}>Dias agência</label><input inputMode="numeric" value={form.dias_agencia} onChange={e => set('dias_agencia', e.target.value)} className={inputCls} /><p className="text-xs text-gray-400 mt-1">A comissão entra no caixa {form.dias_agencia || '0'} dia(s) após a cobrança.</p></div>
          </div>
          <p className="text-xs text-gray-500 mt-3">No Financeiro entram só as comissões: <strong>Comissão (fornecedor)</strong> e <strong>Honorários (cliente)</strong>, e caem no caixa {form.dias_agencia || '0'} dia(s) após a cobrança. O pagamento do cliente ao fornecedor não é lançado.</p>
        </div>

        {/* Parcelas */}
        <div className={cardCls}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Parcelas (pagamento)</h3>
            <div className="flex gap-2">
              <button type="button" onClick={gerarAutomaticas} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition">Gerar automáticas (1x)</button>
              <button type="button" onClick={addParc} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"><Plus className="w-3.5 h-3.5" /> Parcela</button>
            </div>
          </div>
          {form.parcelas.length === 0 ? (
            <p className="text-sm text-gray-400">Nenhuma parcela. Defina as parcelas (vencimento, valor e tipo) ou use “Gerar automáticas”.</p>
          ) : (
            <div className="space-y-2">
              {form.parcelas.map((p, i) => (
                <div key={i} className="flex flex-col sm:flex-row gap-2 sm:items-center">
                  <input type="date" value={p.vencimento} onChange={e => setParc(i, 'vencimento', e.target.value)} className={cn(inputCls, 'sm:w-44')} />
                  <input inputMode="decimal" value={p.valor} onChange={e => setParc(i, 'valor', e.target.value)} placeholder="0,00" className={cn(inputCls, 'sm:w-36 text-right')} />
                  <div className="flex-1"><Select value={p.tipo} onChange={v => setParc(i, 'tipo', v)} options={PARCELA_TIPOS} /></div>
                  <button aria-label="Remover" type="button" onClick={() => delParc(i)} className="text-gray-300 hover:text-red-500 transition shrink-0 self-center"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Textos + status */}
        <div className={cardCls}>
          <label className={labelCls}>Observação</label>
          <textarea rows={3} value={form.observacao} onChange={e => set('observacao', e.target.value)} className={cn(inputCls, 'resize-y min-h-[64px]')} />
          <label className={cn(labelCls, 'mt-4')}>Texto Legal</label>
          <textarea rows={2} value={form.texto_legal} onChange={e => set('texto_legal', e.target.value)} className={cn(inputCls, 'resize-y min-h-[42px]')} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
            <div><label className={labelCls}>Contato</label><input value={form.contato} onChange={e => set('contato', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Responsável</label><Select value={form.responsavel_id} onChange={v => set('responsavel_id', v)} options={memberOptions} placeholder="Selecionar" /></div>
            <div><label className={labelCls}>Situação</label><Select value={form.situacao} onChange={v => set('situacao', v)} options={MIDIA_SITUACAO_OPTIONS} /></div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pb-10">
          <button type="button" onClick={() => router.back()} className="px-4 py-2.5 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
          <button aria-label="Salvar" type="submit" disabled={isPending} className="inline-flex items-center gap-2 px-5 py-2.5 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
