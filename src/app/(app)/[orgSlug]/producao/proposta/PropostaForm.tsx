'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, Loader2, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { MIDIA_SITUACAO_OPTIONS, MIDIA_PRAZO_OPTIONS, formatBRL, parseMoney, labelOf } from '@/lib/midia'
import type { ClienteOpt, MemberOpt } from '../../midias/simplificada/MidiaForm'

export interface ItemProposta { tipo: string; nome: string; descricao: string; quantidade: string; valor_unit: string; desconto: string; situacao: string }
export interface ParcelaProposta { vencimento: string; valor: string }
export interface PropostaValues {
  workspace_id: string; campaign_id: string; titulo: string; emissao: string; validade_dias: string
  agrupar_faturamento: string; prazo: string; data_base: string
  introducao: string; observacao: string; texto_legal: string
  contato: string; responsavel_id: string; situacao: string
  itens: ItemProposta[]
  parcelas: ParcelaProposta[]
}

export const ITEM_TIPOS = [
  { value: 'midia', label: 'Mídia' },
  { value: 'producao', label: 'Produção' },
  { value: 'servico_interno', label: 'Serviço Interno' },
  { value: 'fee', label: 'Fee' },
]
const AGRUPAR = [{ value: 'na_proposta', label: 'Na proposta' }, { value: 'por_item', label: 'Por item' }]
const inputCls = 'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent'
const cellCls = 'w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'
const cardCls = 'bg-white rounded-2xl border border-gray-200 p-5'

const newItem = (tipo = 'midia'): ItemProposta => ({ tipo, nome: '', descricao: '', quantidade: '1', valor_unit: '', desconto: '0', situacao: 'em_aberto' })
const itemValor = (it: ItemProposta) => (parseInt(it.quantidade || '1', 10) || 0) * parseMoney(it.valor_unit) * (1 - parseMoney(it.desconto) / 100)

function emptyValues(today: string, responsavelId: string): PropostaValues {
  return {
    workspace_id: '', campaign_id: '', titulo: '', emissao: today, validade_dias: '',
    agrupar_faturamento: 'na_proposta', prazo: 'a_vista', data_base: today,
    introducao: '', observacao: '', texto_legal: '',
    contato: '', responsavel_id: responsavelId, situacao: 'em_aberto',
    itens: [newItem()], parcelas: [],
  }
}

export function PropostaForm({
  clientes, members, defaultResponsavelId, today, redirectTo, initial, submitLabel = 'Gravar', onSubmit,
}: {
  clientes: ClienteOpt[]; members: MemberOpt[]
  defaultResponsavelId: string; today: string; redirectTo: string
  initial?: Partial<PropostaValues>; submitLabel?: string
  onSubmit: (fd: FormData) => Promise<{ error?: string } | void>
}) {
  const router = useRouter()
  const [form, setForm] = useState<PropostaValues>({ ...emptyValues(today, defaultResponsavelId), ...initial, itens: initial?.itens?.length ? initial.itens : [newItem()], parcelas: initial?.parcelas ?? [] })
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function set<K extends keyof PropostaValues>(k: K, v: PropostaValues[K]) { setForm(f => ({ ...f, [k]: v })) }
  const setItem = (i: number, k: keyof ItemProposta, v: string) => setForm(f => ({ ...f, itens: f.itens.map((it, idx) => idx === i ? { ...it, [k]: v } : it) }))
  const addItem = (tipo: string) => setForm(f => ({ ...f, itens: [...f.itens, newItem(tipo)] }))
  const delItem = (i: number) => setForm(f => ({ ...f, itens: f.itens.filter((_, idx) => idx !== i) }))
  const setParc = (i: number, k: keyof ParcelaProposta, v: string) => setForm(f => ({ ...f, parcelas: f.parcelas.map((p, idx) => idx === i ? { ...p, [k]: v } : p) }))
  const addParc = () => setForm(f => ({ ...f, parcelas: [...f.parcelas, { vencimento: f.data_base, valor: '' }] }))
  const delParc = (i: number) => setForm(f => ({ ...f, parcelas: f.parcelas.filter((_, idx) => idx !== i) }))

  const totalGeral = useMemo(() => form.itens.reduce((s, it) => s + itemValor(it), 0), [form.itens])
  const aprovado = useMemo(() => form.itens.filter(it => it.situacao === 'aprovado').reduce((s, it) => s + itemValor(it), 0), [form.itens])
  const porTipo = useMemo(() => ITEM_TIPOS.map(t => {
    const its = form.itens.filter(it => it.tipo === t.value)
    return { ...t, total: its.reduce((s, it) => s + itemValor(it), 0), aprovado: its.filter(it => it.situacao === 'aprovado').reduce((s, it) => s + itemValor(it), 0) }
  }).filter(t => t.total > 0), [form.itens])

  const campanhaOptions = useMemo(() => {
    const c = clientes.find(c => c.id === form.workspace_id)
    return (c?.campaigns ?? []).map(cp => ({ value: cp.id, label: cp.name }))
  }, [clientes, form.workspace_id])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.workspace_id) { setError('Selecione o cliente'); return }
    if (!form.titulo.trim()) { setError('Informe o título'); return }

    const fd = new FormData()
    const scalars: (keyof PropostaValues)[] = ['workspace_id', 'campaign_id', 'titulo', 'emissao', 'validade_dias', 'observacao', 'texto_legal', 'contato', 'responsavel_id', 'situacao']
    scalars.forEach(k => fd.set(k, String(form[k] ?? '')))
    fd.set('tipo', 'proposta')
    fd.set('valor', String(totalGeral))
    fd.set('redirect_to', redirectTo)
    fd.set('detalhe', JSON.stringify({
      agrupar_faturamento: form.agrupar_faturamento, prazo: form.prazo, data_base: form.data_base,
      introducao: form.introducao, itens: form.itens,
      parcelas: form.parcelas.map(p => ({ vencimento: p.vencimento, valor: String(parseMoney(p.valor)), tipo: 'receber_cliente' })),
    }))

    startTransition(async () => {
      const res = await onSubmit(fd)
      if (res?.error) { setError(res.error); return }
    })
  }

  const clienteOptions = clientes.map(c => ({ value: c.id, label: c.name }))
  const memberOptions = members.map(m => ({ value: m.id, label: m.name }))

  return (
    <div className="p-6 max-w-5xl">
      <button onClick={() => router.back()} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition mb-4">
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>
      <h1 className="text-xl font-semibold text-gray-900 mb-5">{submitLabel === 'Gravar' ? 'Adicionar' : 'Editar'} Proposta</h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        {/* Cabeçalho */}
        <div className={cardCls}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div><label className={labelCls}>Cliente <span className="text-red-500">*</span></label>
              <Select value={form.workspace_id} onChange={v => setForm(f => ({ ...f, workspace_id: v, campaign_id: '' }))} options={clienteOptions} placeholder="Selecionar cliente" /></div>
            <div><label className={labelCls}>Campanha</label>
              <Select value={form.campaign_id} onChange={v => set('campaign_id', v)} options={campanhaOptions} placeholder={form.workspace_id ? 'Selecionar' : 'Escolha o cliente'} /></div>
            <div><label className={labelCls}>Emissão</label><input type="date" value={form.emissao} onChange={e => set('emissao', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Validade (dias)</label><input value={form.validade_dias} onChange={e => set('validade_dias', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Agrupar faturamento</label><Select value={form.agrupar_faturamento} onChange={v => set('agrupar_faturamento', v)} options={AGRUPAR} /></div>
          </div>
          <div className="mt-4"><label className={labelCls}>Título <span className="text-red-500">*</span></label>
            <input value={form.titulo} onChange={e => set('titulo', e.target.value)} className={inputCls} required /></div>
        </div>

        {/* Itens */}
        <div className={cardCls}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Itens</h3>
            <div className="flex flex-wrap gap-1.5">
              {ITEM_TIPOS.map(t => (
                <button aria-label="Adicionar" key={t.value} type="button" onClick={() => addItem(t.value)} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"><Plus className="w-3 h-3" /> {t.label}</button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead><tr className="text-xs font-medium text-gray-400 text-left">
                <th className="px-1 py-1 w-32">Tipo</th><th className="px-1 py-1">Item</th><th className="px-1 py-1 w-16 text-right">Qtd.</th>
                <th className="px-1 py-1 w-28 text-right">Vl. unit.</th><th className="px-1 py-1 w-20 text-right">Desc.%</th>
                <th className="px-1 py-1 w-32">Situação</th><th className="px-1 py-1 w-28 text-right">Total</th><th className="w-8" />
              </tr></thead>
              <tbody>
                {form.itens.map((it, i) => (
                  <tr key={i}>
                    <td className="px-1 py-1"><Select size="sm" value={it.tipo} onChange={v => setItem(i, 'tipo', v)} options={ITEM_TIPOS} /></td>
                    <td className="px-1 py-1"><input value={it.nome} onChange={e => setItem(i, 'nome', e.target.value)} placeholder="Descrição do item" className={cellCls} /></td>
                    <td className="px-1 py-1"><input value={it.quantidade} onChange={e => setItem(i, 'quantidade', e.target.value)} className={cn(cellCls, 'text-right')} /></td>
                    <td className="px-1 py-1"><input inputMode="decimal" value={it.valor_unit} onChange={e => setItem(i, 'valor_unit', e.target.value)} placeholder="0,00" className={cn(cellCls, 'text-right')} /></td>
                    <td className="px-1 py-1"><input inputMode="decimal" value={it.desconto} onChange={e => setItem(i, 'desconto', e.target.value)} className={cn(cellCls, 'text-right')} /></td>
                    <td className="px-1 py-1"><Select size="sm" value={it.situacao} onChange={v => setItem(i, 'situacao', v)} options={MIDIA_SITUACAO_OPTIONS} /></td>
                    <td className="px-1 py-1 text-right font-medium whitespace-nowrap">{formatBRL(itemValor(it))}</td>
                    <td className="px-1 py-1 text-right">{form.itens.length > 1 && <button aria-label="Remover" type="button" onClick={() => delItem(i)} className="text-gray-300 hover:text-red-500 transition"><Trash2 className="w-3.5 h-3.5" /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Valor por tipo + totais */}
        <div className={cardCls}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Valor por tipo</h3>
          <table className="w-full sm:w-2/3 text-sm">
            <thead><tr className="text-xs text-gray-400 text-left"><th className="py-1">Tipo</th><th className="py-1 text-right">Total</th><th className="py-1 text-right">Aprovado</th></tr></thead>
            <tbody>
              {porTipo.length === 0 ? <tr><td className="py-1.5 text-gray-400" colSpan={3}>Sem itens.</td></tr> : porTipo.map(t => (
                <tr key={t.value} className="border-t border-gray-100"><td className="py-1.5">{labelOf(ITEM_TIPOS, t.value)}</td><td className="py-1.5 text-right">{formatBRL(t.total)}</td><td className="py-1.5 text-right">{formatBRL(t.aprovado)}</td></tr>
              ))}
              <tr className="border-t border-gray-200 font-semibold"><td className="py-1.5">Total</td><td className="py-1.5 text-right">{formatBRL(totalGeral)}</td><td className="py-1.5 text-right text-emerald-600">{formatBRL(aprovado)}</td></tr>
            </tbody>
          </table>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
            <div><label className={labelCls}>Prazo</label><Select value={form.prazo} onChange={v => set('prazo', v)} options={MIDIA_PRAZO_OPTIONS} /></div>
            <div><label className={labelCls}>Data Base</label><input type="date" value={form.data_base} onChange={e => set('data_base', e.target.value)} className={inputCls} /></div>
          </div>
        </div>

        {/* Cobrança / parcelas (proposta faturada nela mesma = job) */}
        <div className={cardCls}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Cobrança (parcelas a receber)</h3>
              <p className="text-xs text-gray-400 mt-0.5">Use quando a proposta é faturada nela mesma (job), sem gerar mídia/produção/fee.</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setForm(f => ({ ...f, parcelas: [{ vencimento: f.data_base, valor: String(totalGeral) }] }))} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition">1x (total)</button>
              <button type="button" onClick={addParc} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"><Plus className="w-3.5 h-3.5" /> Parcela</button>
            </div>
          </div>
          {form.parcelas.length === 0 ? (
            <p className="text-sm text-gray-400">Sem parcelas. Para um job, defina as parcelas aqui (viram lançamentos quando Faturada). Para gerar mídia/produção/fee, use “Gerar docs” na lista.</p>
          ) : (
            <div className="space-y-2">
              {form.parcelas.map((p, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input type="date" value={p.vencimento} onChange={e => setParc(i, 'vencimento', e.target.value)} className={cn(inputCls, 'sm:w-48')} />
                  <input inputMode="decimal" value={p.valor} onChange={e => setParc(i, 'valor', e.target.value)} placeholder="0,00" className={cn(inputCls, 'sm:w-40 text-right')} />
                  <span className="text-xs text-gray-400 flex-1">Receber do Cliente</span>
                  <button aria-label="Remover" type="button" onClick={() => delParc(i)} className="text-gray-300 hover:text-red-500 transition shrink-0"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Textos */}
        <div className={cardCls}>
          <label className={labelCls}>Introdução</label>
          <textarea rows={4} value={form.introducao} onChange={e => set('introducao', e.target.value)} className={cn(inputCls, 'resize-y min-h-[80px]')} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <div><label className={labelCls}>Observação</label><textarea rows={3} value={form.observacao} onChange={e => set('observacao', e.target.value)} className={cn(inputCls, 'resize-y min-h-[64px]')} /></div>
            <div><label className={labelCls}>Texto Legal</label><textarea rows={3} value={form.texto_legal} onChange={e => set('texto_legal', e.target.value)} className={cn(inputCls, 'resize-y min-h-[64px]')} /></div>
          </div>
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
