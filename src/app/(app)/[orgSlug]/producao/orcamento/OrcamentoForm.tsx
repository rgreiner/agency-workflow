'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, Loader2, Plus, Trash2, CircleCheck, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { MIDIA_SITUACAO_OPTIONS, formatBRL, parseMoney } from '@/lib/midia'
import { ItemImageField } from '@/components/ui/ItemImageField'
import type { ClienteOpt, MemberOpt } from '../../midias/simplificada/MidiaForm'
import type { FornecedorOpt } from '@/lib/midia-selectors'

export interface Opcao { fornecedor_id: string; n_orc: string; pgto: string; quant: string; valor_unit: string; selecionado: boolean }
export interface ItemOrc { nome: string; descricao: string; job: string; opcoes: Opcao[]; imagem?: string }
export interface OrcamentoValues {
  workspace_id: string; campaign_id: string; faturar: string; emissao: string; validade_dias: string; bv_pct: string
  codigo_identificador: string; nota_fiscal: string; titulo: string; honorarios_pct: string
  contato: string; responsavel_id: string; situacao: string; observacao: string; texto_legal: string
  itens: ItemOrc[]
}

const FATURAR = [{ value: 'contra_cliente', label: 'Contra o Cliente' }, { value: 'contra_agencia', label: 'Contra a Agência' }]
const inputCls = 'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent'
const cellCls = 'w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'
const cardCls = 'bg-white rounded-2xl border border-gray-200 p-5'

const newOpcao = (): Opcao => ({ fornecedor_id: '', n_orc: '', pgto: '', quant: '1', valor_unit: '', selecionado: false })
const newItem = (): ItemOrc => ({ nome: '', descricao: '', job: '', opcoes: [newOpcao()] })
const opcaoTotal = (o: Opcao) => (parseInt(o.quant || '1', 10) || 0) * parseMoney(o.valor_unit)

function emptyValues(today: string, responsavelId: string): OrcamentoValues {
  return {
    workspace_id: '', campaign_id: '', faturar: 'contra_cliente', emissao: today, validade_dias: '', bv_pct: '15',
    codigo_identificador: '', nota_fiscal: '', titulo: '', honorarios_pct: '0',
    contato: '', responsavel_id: responsavelId, situacao: 'em_aberto', observacao: '', texto_legal: '',
    itens: [newItem()],
  }
}

export function OrcamentoForm({
  clientes, fornecedores, members, defaultResponsavelId, today, redirectTo, initial, submitLabel = 'Gravar', onSubmit,
}: {
  clientes: ClienteOpt[]; fornecedores: FornecedorOpt[]; members: MemberOpt[]
  defaultResponsavelId: string; today: string; redirectTo: string
  initial?: Partial<OrcamentoValues>; submitLabel?: string
  onSubmit: (fd: FormData) => Promise<{ error?: string } | void>
}) {
  const router = useRouter()
  const [form, setForm] = useState<OrcamentoValues>({
    ...emptyValues(today, defaultResponsavelId), ...initial,
    itens: initial?.itens?.length ? initial.itens : [newItem()],
  })
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function set<K extends keyof OrcamentoValues>(k: K, v: OrcamentoValues[K]) { setForm(f => ({ ...f, [k]: v })) }
  const patchItem = (i: number, patch: Partial<ItemOrc>) => setForm(f => ({ ...f, itens: f.itens.map((it, idx) => idx === i ? { ...it, ...patch } : it) }))
  const addItem = () => setForm(f => ({ ...f, itens: [...f.itens, newItem()] }))
  const delItem = (i: number) => setForm(f => ({ ...f, itens: f.itens.filter((_, idx) => idx !== i) }))
  const setOpcao = (ii: number, oi: number, k: keyof Opcao, v: string | boolean) =>
    setForm(f => ({ ...f, itens: f.itens.map((it, idx) => idx !== ii ? it : { ...it, opcoes: it.opcoes.map((o, jdx) => jdx === oi ? { ...o, [k]: v } : o) }) }))
  const selectOpcao = (ii: number, oi: number) =>
    setForm(f => ({ ...f, itens: f.itens.map((it, idx) => idx !== ii ? it : { ...it, opcoes: it.opcoes.map((o, jdx) => ({ ...o, selecionado: jdx === oi })) }) }))
  const addOpcao = (ii: number) => setForm(f => ({ ...f, itens: f.itens.map((it, idx) => idx === ii ? { ...it, opcoes: [...it.opcoes, newOpcao()] } : it) }))
  const delOpcao = (ii: number, oi: number) => setForm(f => ({ ...f, itens: f.itens.map((it, idx) => idx === ii ? { ...it, opcoes: it.opcoes.filter((_, jdx) => jdx !== oi) } : it) }))

  const valorFaturar = useMemo(() => form.itens.reduce((s, it) => {
    const sel = it.opcoes.find(o => o.selecionado) ?? it.opcoes[0]
    return s + (sel ? opcaoTotal(sel) : 0)
  }, 0), [form.itens])
  const honorarios = valorFaturar * (parseMoney(form.honorarios_pct) / 100)
  const valorTotal = valorFaturar + honorarios

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
    const scalars: (keyof OrcamentoValues)[] = ['workspace_id', 'campaign_id', 'faturar', 'emissao', 'validade_dias', 'codigo_identificador', 'nota_fiscal', 'titulo', 'contato', 'responsavel_id', 'situacao', 'observacao', 'texto_legal']
    scalars.forEach(k => fd.set(k, String(form[k] ?? '')))
    fd.set('tipo', 'orcamento')
    fd.set('bv_pct', String(parseMoney(form.bv_pct)))
    fd.set('honorarios_pct', String(parseMoney(form.honorarios_pct)))
    fd.set('valor', String(valorFaturar))
    fd.set('redirect_to', redirectTo)
    fd.set('detalhe', JSON.stringify({ itens: form.itens }))

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
      <h1 className="text-xl font-semibold text-gray-900 mb-5">{submitLabel === 'Gravar' ? 'Adicionar' : 'Editar'} Orçamento</h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        {/* Cabeçalho */}
        <div className={cardCls}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div><label className={labelCls}>Cliente <span className="text-red-500">*</span></label>
              <Select value={form.workspace_id} onChange={v => setForm(f => ({ ...f, workspace_id: v, campaign_id: '' }))} options={clienteOptions} placeholder="Selecionar cliente" /></div>
            <div><label className={labelCls}>Campanha</label>
              <Select value={form.campaign_id} onChange={v => set('campaign_id', v)} options={campanhaOptions} placeholder={form.workspace_id ? 'Selecionar' : 'Escolha o cliente'} /></div>
            <div><label className={labelCls}>Faturar</label><Select value={form.faturar} onChange={v => set('faturar', v)} options={FATURAR} /></div>
            <div><label className={labelCls}>Emissão</label><input type="date" value={form.emissao} onChange={e => set('emissao', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Validade (dias)</label><input value={form.validade_dias} onChange={e => set('validade_dias', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>BV (%)</label><input inputMode="decimal" value={form.bv_pct} onChange={e => set('bv_pct', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Código Identificador</label><input value={form.codigo_identificador} onChange={e => set('codigo_identificador', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Nota Fiscal</label><input value={form.nota_fiscal} onChange={e => set('nota_fiscal', e.target.value)} className={inputCls} /></div>
          </div>
          <div className="mt-4"><label className={labelCls}>Título <span className="text-red-500">*</span></label>
            <input value={form.titulo} onChange={e => set('titulo', e.target.value)} className={inputCls} required /></div>
        </div>

        {/* Itens */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Itens</h3>
            <button type="button" onClick={addItem} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"><Plus className="w-3.5 h-3.5" /> Adicionar item</button>
          </div>
          {form.itens.map((it, ii) => (
            <div key={ii} className={cardCls}>
              <div className="flex items-start gap-3 mb-3">
                <ItemImageField value={it.imagem} onChange={url => patchItem(ii, { imagem: url })} />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <input value={it.nome} onChange={e => patchItem(ii, { nome: e.target.value })} placeholder="Nome do item (ex.: WordPress, Camisetas Polo)" className={cn(inputCls, 'font-medium')} />
                    {form.itens.length > 1 && <button aria-label="Remover" type="button" onClick={() => delItem(ii)} className="text-gray-300 hover:text-red-500 transition shrink-0"><Trash2 className="w-4 h-4" /></button>}
                  </div>
                  <label className={cn(labelCls, 'mt-2')}>Descrição</label>
                  <textarea rows={2} value={it.descricao} onChange={e => patchItem(ii, { descricao: e.target.value })} className={cn(inputCls, 'resize-none')} />
                </div>
              </div>

              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Opções (fornecedores)</span>
                <button type="button" onClick={() => addOpcao(ii)} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"><Plus className="w-3 h-3" /> Opção</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead><tr className="text-[11px] font-medium text-gray-400 text-left">
                    <th className="px-1 py-1 w-10" /><th className="px-1 py-1">Fornecedor</th><th className="px-1 py-1 w-24">Nº Orç.</th><th className="px-1 py-1 w-24">Pgto.</th>
                    <th className="px-1 py-1 w-20 text-right">Quant.</th><th className="px-1 py-1 w-28 text-right">Valor unit.</th><th className="px-1 py-1 w-28 text-right">Total</th><th className="w-8" />
                  </tr></thead>
                  <tbody>
                    {it.opcoes.map((o, oi) => (
                      <tr key={oi} className={o.selecionado ? 'bg-emerald-50/50' : undefined}>
                        <td className="px-1 py-1 text-center">
                          <button type="button" onClick={() => selectOpcao(ii, oi)} title="Escolher esta opção" className={o.selecionado ? 'text-emerald-600' : 'text-gray-300 hover:text-gray-500'}>
                            {o.selecionado ? <CircleCheck className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                          </button>
                        </td>
                        <td className="px-1 py-1"><Select size="sm" value={o.fornecedor_id} onChange={v => setOpcao(ii, oi, 'fornecedor_id', v)} options={fornecedorOptions} placeholder="Fornecedor" /></td>
                        <td className="px-1 py-1"><input value={o.n_orc} onChange={e => setOpcao(ii, oi, 'n_orc', e.target.value)} className={cellCls} /></td>
                        <td className="px-1 py-1"><input value={o.pgto} onChange={e => setOpcao(ii, oi, 'pgto', e.target.value)} className={cellCls} /></td>
                        <td className="px-1 py-1"><input value={o.quant} onChange={e => setOpcao(ii, oi, 'quant', e.target.value)} className={cn(cellCls, 'text-right')} /></td>
                        <td className="px-1 py-1"><input inputMode="decimal" value={o.valor_unit} onChange={e => setOpcao(ii, oi, 'valor_unit', e.target.value)} placeholder="0,00" className={cn(cellCls, 'text-right')} /></td>
                        <td className="px-1 py-1 text-right font-medium whitespace-nowrap">{formatBRL(opcaoTotal(o))}</td>
                        <td className="px-1 py-1 text-right">{it.opcoes.length > 1 && <button aria-label="Remover" type="button" onClick={() => delOpcao(ii, oi)} className="text-gray-300 hover:text-red-500 transition"><Trash2 className="w-3.5 h-3.5" /></button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>

        {/* Totais */}
        <div className={cardCls}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
            <div><p className="text-xs text-gray-400">Valor a Faturar</p><p className="text-lg font-semibold text-gray-900">{formatBRL(valorFaturar)}</p></div>
            <div><label className={labelCls}>Honorários (%)</label><input inputMode="decimal" value={form.honorarios_pct} onChange={e => set('honorarios_pct', e.target.value)} className={inputCls} /><p className="text-xs text-gray-400 mt-1">{formatBRL(honorarios)}</p></div>
            <div><p className="text-xs text-gray-400">Valor Total</p><p className="text-lg font-semibold text-gray-900">{formatBRL(valorTotal)}</p></div>
          </div>
        </div>

        {/* Textos + status */}
        <div className={cardCls}>
          <label className={labelCls}>Observação</label>
          <textarea rows={3} value={form.observacao} onChange={e => set('observacao', e.target.value)} className={cn(inputCls, 'resize-none')} />
          <label className={cn(labelCls, 'mt-4')}>Texto Legal</label>
          <textarea rows={2} value={form.texto_legal} onChange={e => set('texto_legal', e.target.value)} className={cn(inputCls, 'resize-none')} />
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
