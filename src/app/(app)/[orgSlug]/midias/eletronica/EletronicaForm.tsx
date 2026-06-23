'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, Loader2, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import {
  MIDIA_FATURAMENTO_OPTIONS, MIDIA_PRAZO_OPTIONS, MIDIA_ABRANGENCIA_OPTIONS,
  MIDIA_SITUACAO_OPTIONS, FATURAMENTO_PAGADOR, formatBRL, parseMoney,
} from '@/lib/midia'
import type { ClienteOpt, VeiculoOpt, MemberOpt } from '../simplificada/MidiaForm'

export interface PecaEl { peca: string; tipo: string; descricao: string; duracao: string }
export interface PeriodoItem { peca: string; programa: string; tipo: string; valor_unitario: string; desconto: string; dias: Record<string, string> }
export interface Periodo { mes: string; ano: string; itens: PeriodoItem[] }
export interface EletronicaValues {
  workspace_id: string; campaign_id: string; veiculo_id: string; titulo: string
  emissao: string; job: string; aut_veiculo: string; codigo_identificador: string; nota_fiscal: string
  praca: string; abrangencia: string
  desconto_pct: string; faturamento: string; prazo: string; data_base: string; dias_agencia: string
  primeira_veiculacao: string; ultima_veiculacao: string; contato: string; responsavel_id: string; situacao: string
  observacao: string; texto_legal: string
  pecas: PecaEl[]; periodos: Periodo[]
}

const MESES = [
  { value: '1', label: 'Janeiro' }, { value: '2', label: 'Fevereiro' }, { value: '3', label: 'Março' },
  { value: '4', label: 'Abril' }, { value: '5', label: 'Maio' }, { value: '6', label: 'Junho' },
  { value: '7', label: 'Julho' }, { value: '8', label: 'Agosto' }, { value: '9', label: 'Setembro' },
  { value: '10', label: 'Outubro' }, { value: '11', label: 'Novembro' }, { value: '12', label: 'Dezembro' },
]
const ANOS = ['2024', '2025', '2026', '2027'].map(a => ({ value: a, label: a }))
const WD = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

const inputCls = 'w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent'
const cellCls = 'w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'
const cardCls = 'bg-white rounded-2xl border border-gray-200 p-5'

const newPeca = (): PecaEl => ({ peca: 'A', tipo: 'TV Aberta', descricao: '', duracao: '30' })
const newItem = (): PeriodoItem => ({ peca: 'A', programa: '', tipo: 'Ins', valor_unitario: '', desconto: '0', dias: {} })
function newPeriodo(today: string): Periodo {
  const [y, m] = today.split('-')
  return { mes: String(Number(m)), ano: y, itens: [newItem()] }
}
function emptyValues(today: string, responsavelId: string): EletronicaValues {
  return {
    workspace_id: '', campaign_id: '', veiculo_id: '', titulo: '',
    emissao: today, job: '', aut_veiculo: '', codigo_identificador: '', nota_fiscal: '',
    praca: '', abrangencia: 'estadual',
    desconto_pct: '20', faturamento: 'valor_bruto', prazo: '15_dfm', data_base: today, dias_agencia: '7',
    primeira_veiculacao: '', ultima_veiculacao: '', contato: '', responsavel_id: responsavelId, situacao: 'em_aberto',
    observacao: '', texto_legal: '', pecas: [newPeca()], periodos: [newPeriodo(today)],
  }
}

const exibOf = (it: PeriodoItem) => Object.values(it.dias).reduce((s, v) => s + (parseInt(v || '0', 10) || 0), 0)
const totalItem = (it: PeriodoItem) => exibOf(it) * parseMoney(it.valor_unitario) * (1 - parseMoney(it.desconto) / 100)
const totalPeriodo = (p: Periodo) => p.itens.reduce((s, it) => s + totalItem(it), 0)

export function EletronicaForm({
  clientes, veiculos, members, defaultResponsavelId, today, redirectTo, initial, submitLabel = 'Gravar', onSubmit,
}: {
  clientes: ClienteOpt[]; veiculos: VeiculoOpt[]; members: MemberOpt[]
  defaultResponsavelId: string; today: string; redirectTo: string
  initial?: Partial<EletronicaValues>; submitLabel?: string
  onSubmit: (fd: FormData) => Promise<{ error?: string } | void>
}) {
  const router = useRouter()
  const [form, setForm] = useState<EletronicaValues>({
    ...emptyValues(today, defaultResponsavelId), ...initial,
    pecas: initial?.pecas?.length ? initial.pecas : [newPeca()],
    periodos: initial?.periodos?.length ? initial.periodos : [newPeriodo(today)],
  })
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function set<K extends keyof EletronicaValues>(k: K, v: EletronicaValues[K]) { setForm(f => ({ ...f, [k]: v })) }

  // Peças
  const setPeca = (i: number, k: keyof PecaEl, v: string) => setForm(f => ({ ...f, pecas: f.pecas.map((p, idx) => idx === i ? { ...p, [k]: v } : p) }))
  const addPeca = () => setForm(f => ({ ...f, pecas: [...f.pecas, newPeca()] }))
  const delPeca = (i: number) => setForm(f => ({ ...f, pecas: f.pecas.filter((_, idx) => idx !== i) }))

  // Períodos
  const setPeriodo = (pi: number, patch: Partial<Periodo>) => setForm(f => ({ ...f, periodos: f.periodos.map((p, idx) => idx === pi ? { ...p, ...patch } : p) }))
  const addPeriodo = () => setForm(f => ({ ...f, periodos: [...f.periodos, newPeriodo(today)] }))
  const delPeriodo = (pi: number) => setForm(f => ({ ...f, periodos: f.periodos.filter((_, idx) => idx !== pi) }))
  const setItem = (pi: number, ii: number, k: keyof PeriodoItem, v: PeriodoItem[keyof PeriodoItem]) =>
    setForm(f => ({ ...f, periodos: f.periodos.map((p, idx) => idx !== pi ? p : { ...p, itens: p.itens.map((it, jdx) => jdx === ii ? { ...it, [k]: v } : it) }) }))
  const setItemDia = (pi: number, ii: number, d: number, v: string) =>
    setForm(f => ({ ...f, periodos: f.periodos.map((p, idx) => idx !== pi ? p : {
      ...p, itens: p.itens.map((it, jdx) => {
        if (jdx !== ii) return it
        const dias = { ...it.dias }; if (!v || v === '0') delete dias[d]; else dias[d] = v
        return { ...it, dias }
      }),
    }) }))
  const addItem = (pi: number) => setForm(f => ({ ...f, periodos: f.periodos.map((p, idx) => idx === pi ? { ...p, itens: [...p.itens, newItem()] } : p) }))
  const delItem = (pi: number, ii: number) => setForm(f => ({ ...f, periodos: f.periodos.map((p, idx) => idx === pi ? { ...p, itens: p.itens.filter((_, jdx) => jdx !== ii) } : p) }))

  const valor = useMemo(() => form.periodos.reduce((s, p) => s + totalPeriodo(p), 0), [form.periodos])
  const comissao = valor * (parseMoney(form.desconto_pct) / 100)
  const pagador = FATURAMENTO_PAGADOR[form.faturamento] ?? 'cliente'
  const pecaOptions = form.pecas.map(p => ({ value: p.peca, label: p.peca || '—' }))

  const campanhaOptions = useMemo(() => {
    const c = clientes.find(c => c.id === form.workspace_id)
    return (c?.campaigns ?? []).map(cp => ({ value: cp.id, label: cp.name }))
  }, [clientes, form.workspace_id])

  function onVeiculoChange(v: string) {
    const veic = veiculos.find(x => x.id === v)
    setForm(f => ({ ...f, veiculo_id: v, desconto_pct: veic?.commission_pct != null ? String(veic.commission_pct).replace('.', ',') : f.desconto_pct }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.workspace_id) { setError('Selecione o cliente'); return }
    if (!form.veiculo_id) { setError('Selecione o veículo'); return }
    if (!form.titulo.trim()) { setError('Informe o produto/título'); return }

    const fd = new FormData()
    const scalars: (keyof EletronicaValues)[] = ['workspace_id', 'campaign_id', 'veiculo_id', 'titulo', 'emissao', 'job', 'aut_veiculo', 'codigo_identificador', 'nota_fiscal', 'praca', 'abrangencia', 'faturamento', 'prazo', 'data_base', 'dias_agencia', 'primeira_veiculacao', 'ultima_veiculacao', 'contato', 'responsavel_id', 'situacao', 'observacao', 'texto_legal']
    scalars.forEach(k => fd.set(k, String(form[k] ?? '')))
    fd.set('tipo', 'eletronica')
    fd.set('valor', String(valor))
    fd.set('desconto_pct', String(parseMoney(form.desconto_pct)))
    fd.set('redirect_to', redirectTo)
    fd.set('detalhe', JSON.stringify({ pecas: form.pecas, periodos: form.periodos }))

    startTransition(async () => {
      const res = await onSubmit(fd)
      if (res?.error) { setError(res.error); return }
    })
  }

  const clienteOptions = clientes.map(c => ({ value: c.id, label: c.name }))
  const veiculoOptions = veiculos.map(v => ({ value: v.id, label: v.name }))
  const memberOptions = members.map(m => ({ value: m.id, label: m.name }))

  return (
    <div className="p-6 max-w-6xl">
      <button onClick={() => router.back()} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition mb-4">
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>
      <h1 className="text-xl font-semibold text-gray-900 mb-5">{submitLabel === 'Gravar' ? 'Adicionar' : 'Editar'} Mídia Eletrônica</h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        {/* Cabeçalho */}
        <div className={cardCls}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div><label className={labelCls}>Cliente <span className="text-red-500">*</span></label>
              <Select value={form.workspace_id} onChange={v => setForm(f => ({ ...f, workspace_id: v, campaign_id: '' }))} options={clienteOptions} placeholder="Selecionar cliente" /></div>
            <div><label className={labelCls}>Campanha</label>
              <Select value={form.campaign_id} onChange={v => set('campaign_id', v)} options={campanhaOptions} placeholder={form.workspace_id ? 'Selecionar' : 'Escolha o cliente'} /></div>
            <div><label className={labelCls}>Veículo <span className="text-red-500">*</span></label>
              <Select value={form.veiculo_id} onChange={onVeiculoChange} options={veiculoOptions} placeholder="Selecionar veículo" /></div>
            <div><label className={labelCls}>Emissão</label><input type="date" value={form.emissao} onChange={e => set('emissao', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Job</label><input value={form.job} onChange={e => set('job', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Aut. no Veículo</label><input value={form.aut_veiculo} onChange={e => set('aut_veiculo', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Código Identificador</label><input value={form.codigo_identificador} onChange={e => set('codigo_identificador', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Nota Fiscal</label><input value={form.nota_fiscal} onChange={e => set('nota_fiscal', e.target.value)} className={inputCls} /></div>
          </div>
          <div className="mt-4"><label className={labelCls}>Produto / Título <span className="text-red-500">*</span></label>
            <input value={form.titulo} onChange={e => set('titulo', e.target.value)} className={inputCls} required /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <div><label className={labelCls}>Praça</label><input value={form.praca} onChange={e => set('praca', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Abrangência</label><Select value={form.abrangencia} onChange={v => set('abrangencia', v)} options={MIDIA_ABRANGENCIA_OPTIONS} /></div>
          </div>
        </div>

        {/* Peças */}
        <div className={cardCls}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Peças</h3>
            <button type="button" onClick={addPeca} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"><Plus className="w-3.5 h-3.5" /> Adicionar</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="text-xs font-medium text-gray-400 text-left">
                <th className="px-1 py-1 w-20">Peça</th><th className="px-1 py-1 w-40">Tipo</th><th className="px-1 py-1">Descrição</th><th className="px-1 py-1 w-36">Duração (seg)</th><th className="w-8" />
              </tr></thead>
              <tbody>
                {form.pecas.map((p, i) => (
                  <tr key={i}>
                    <td className="px-1 py-1"><input value={p.peca} onChange={e => setPeca(i, 'peca', e.target.value)} className={cellCls} /></td>
                    <td className="px-1 py-1"><input value={p.tipo} onChange={e => setPeca(i, 'tipo', e.target.value)} placeholder="Ex.: TV Aberta" className={cellCls} /></td>
                    <td className="px-1 py-1"><input value={p.descricao} onChange={e => setPeca(i, 'descricao', e.target.value)} placeholder="Ex.: VT" className={cellCls} /></td>
                    <td className="px-1 py-1"><input value={p.duracao} onChange={e => setPeca(i, 'duracao', e.target.value)} className={cn(cellCls, 'text-right')} /></td>
                    <td className="px-1 py-1 text-right">{form.pecas.length > 1 && <button type="button" onClick={() => delPeca(i)} className="text-gray-300 hover:text-red-500 transition"><Trash2 className="w-3.5 h-3.5" /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Períodos */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Períodos</h3>
            <button type="button" onClick={addPeriodo} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"><Plus className="w-3.5 h-3.5" /> Adicionar período</button>
          </div>
          {form.periodos.map((p, pi) => {
            const diasNoMes = new Date(Number(p.ano), Number(p.mes), 0).getDate() || 30
            return (
              <div key={pi} className={cardCls}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-40"><label className={labelCls}>Mês</label><Select size="sm" value={p.mes} onChange={v => setPeriodo(pi, { mes: v })} options={MESES} /></div>
                  <div className="w-28"><label className={labelCls}>Ano</label><Select size="sm" value={p.ano} onChange={v => setPeriodo(pi, { ano: v })} options={ANOS} /></div>
                  <div className="flex-1" />
                  {form.periodos.length > 1 && <button type="button" onClick={() => delPeriodo(pi)} className="text-gray-300 hover:text-red-500 transition mt-4"><Trash2 className="w-4 h-4" /></button>}
                </div>
                <div className="overflow-x-auto">
                  <table className="text-sm">
                    <thead>
                      <tr className="text-[10px] font-medium text-gray-400">
                        <th className="px-1 py-1 text-left w-16 sticky left-0 bg-white">Peça</th>
                        <th className="px-1 py-1 text-left w-40 sticky left-16 bg-white">Programa</th>
                        {Array.from({ length: diasNoMes }, (_, idx) => {
                          const d = idx + 1; const wd = WD[new Date(Number(p.ano), Number(p.mes) - 1, d).getDay()]
                          return <th key={d} className="px-0.5 py-1 w-7 text-center"><div className="text-gray-600">{d}</div><div>{wd}</div></th>
                        })}
                        <th className="px-1 py-1 w-12 text-right">Exib.</th>
                        <th className="px-1 py-1 w-28 text-right">Vl. unit.</th>
                        <th className="px-1 py-1 w-16 text-right">Desc%</th>
                        <th className="px-1 py-1 w-28 text-right">Total</th>
                        <th className="w-6" />
                      </tr>
                    </thead>
                    <tbody>
                      {p.itens.map((it, ii) => (
                        <tr key={ii}>
                          <td className="px-1 py-1 sticky left-0 bg-white"><Select size="sm" value={it.peca} onChange={v => setItem(pi, ii, 'peca', v)} options={pecaOptions} /></td>
                          <td className="px-1 py-1 sticky left-16 bg-white"><input value={it.programa} onChange={e => setItem(pi, ii, 'programa', e.target.value)} className={cellCls} placeholder="Programa" /></td>
                          {Array.from({ length: diasNoMes }, (_, idx) => {
                            const d = idx + 1
                            return <td key={d} className="px-0.5 py-1"><input value={it.dias[d] ?? ''} onChange={e => setItemDia(pi, ii, d, e.target.value)} className="w-7 h-7 text-center text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500" /></td>
                          })}
                          <td className="px-1 py-1 text-right font-medium">{exibOf(it)}</td>
                          <td className="px-1 py-1"><input inputMode="decimal" value={it.valor_unitario} onChange={e => setItem(pi, ii, 'valor_unitario', e.target.value)} placeholder="0,00" className={cn(cellCls, 'text-right')} /></td>
                          <td className="px-1 py-1"><input inputMode="decimal" value={it.desconto} onChange={e => setItem(pi, ii, 'desconto', e.target.value)} className={cn(cellCls, 'text-right')} /></td>
                          <td className="px-1 py-1 text-right font-medium whitespace-nowrap">{formatBRL(totalItem(it))}</td>
                          <td className="px-1 py-1 text-right">{p.itens.length > 1 && <button type="button" onClick={() => delItem(pi, ii)} className="text-gray-300 hover:text-red-500 transition"><Trash2 className="w-3.5 h-3.5" /></button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <button type="button" onClick={() => addItem(pi)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"><Plus className="w-3.5 h-3.5" /> Adicionar linha</button>
                  <span className="text-sm text-gray-600">Total do período: <strong className="text-gray-900">{formatBRL(totalPeriodo(p))}</strong></span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Preços / financeiro */}
        <div className={cardCls}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Preços</h3>
            <span className="text-sm">Valor: <strong className="text-gray-900">{formatBRL(valor)}</strong></span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div><label className={labelCls}>Desconto Padrão Agência (%)</label><input inputMode="decimal" value={form.desconto_pct} onChange={e => set('desconto_pct', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Faturamento</label><Select value={form.faturamento} onChange={v => set('faturamento', v)} options={MIDIA_FATURAMENTO_OPTIONS} /></div>
            <div className="flex items-end"><p className="text-sm text-gray-600">Comissão: <strong className="text-emerald-600">{formatBRL(comissao)}</strong> <span className="text-gray-400">({pagador === 'veiculo' ? 'veículo' : 'cliente'})</span></p></div>
            <div><label className={labelCls}>Prazo</label><Select value={form.prazo} onChange={v => set('prazo', v)} options={MIDIA_PRAZO_OPTIONS} /></div>
            <div><label className={labelCls}>Data Base</label><input type="date" value={form.data_base} onChange={e => set('data_base', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Dias Agência</label><input type="number" value={form.dias_agencia} onChange={e => set('dias_agencia', e.target.value)} className={inputCls} /></div>
          </div>
        </div>

        {/* Veiculação & status */}
        <div className={cardCls}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div><label className={labelCls}>Primeira Veiculação</label><input type="date" value={form.primeira_veiculacao} onChange={e => set('primeira_veiculacao', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Última Veiculação</label><input type="date" value={form.ultima_veiculacao} onChange={e => set('ultima_veiculacao', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Contato</label><input value={form.contato} onChange={e => set('contato', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Responsável</label><Select value={form.responsavel_id} onChange={v => set('responsavel_id', v)} options={memberOptions} placeholder="Selecionar" /></div>
            <div><label className={labelCls}>Situação</label><Select value={form.situacao} onChange={v => set('situacao', v)} options={MIDIA_SITUACAO_OPTIONS} /></div>
          </div>
        </div>

        {/* Textos */}
        <div className={cardCls}>
          <label className={labelCls}>Observação</label>
          <textarea rows={3} value={form.observacao} onChange={e => set('observacao', e.target.value)} className={cn(inputCls, 'resize-none')} />
          <label className={cn(labelCls, 'mt-4')}>Texto Legal</label>
          <textarea rows={3} value={form.texto_legal} onChange={e => set('texto_legal', e.target.value)} className={cn(inputCls, 'resize-none')} />
        </div>

        <div className="flex justify-end gap-2 pb-10">
          <button type="button" onClick={() => router.back()} className="px-4 py-2.5 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
          <button type="submit" disabled={isPending} className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition">
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
