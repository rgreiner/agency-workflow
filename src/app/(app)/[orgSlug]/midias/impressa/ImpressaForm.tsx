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

export interface Insercao {
  formato: string; mes: string; ano: string; insercoes: string; edicao: string
  abrangencia: string; determinacao: string; data_base: string; valor: string; desconto: string
}
export interface ImpressaValues {
  workspace_id: string; campaign_id: string; veiculo_id: string; titulo: string
  emissao: string; job: string; aut_veiculo: string; codigo_identificador: string; nota_fiscal: string
  revista: string; periodo: string
  desconto_pct: string; faturamento: string; prazo: string; data_base: string; dias_agencia: string
  primeira_veiculacao: string; ultima_veiculacao: string; contato: string; responsavel_id: string; situacao: string
  observacao: string; texto_legal: string
  insercoes: Insercao[]
}

const MESES = [
  { value: '1', label: 'Janeiro' }, { value: '2', label: 'Fevereiro' }, { value: '3', label: 'Março' },
  { value: '4', label: 'Abril' }, { value: '5', label: 'Maio' }, { value: '6', label: 'Junho' },
  { value: '7', label: 'Julho' }, { value: '8', label: 'Agosto' }, { value: '9', label: 'Setembro' },
  { value: '10', label: 'Outubro' }, { value: '11', label: 'Novembro' }, { value: '12', label: 'Dezembro' },
]
const ANOS = ['2024', '2025', '2026', '2027'].map(a => ({ value: a, label: a }))

const inputCls = 'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent'
const cellCls = 'w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'
const cardCls = 'bg-white rounded-2xl border border-gray-200 p-5'

function emptyInsercao(today: string): Insercao {
  const [y, m] = today.split('-')
  return { formato: 'Página', mes: String(Number(m)), ano: y, insercoes: '1', edicao: '', abrangencia: 'regional', determinacao: '', data_base: today, valor: '', desconto: '0' }
}
function emptyValues(today: string, responsavelId: string): ImpressaValues {
  return {
    workspace_id: '', campaign_id: '', veiculo_id: '', titulo: '',
    emissao: today, job: '', aut_veiculo: '', codigo_identificador: '', nota_fiscal: '',
    revista: '', periodo: '',
    desconto_pct: '20', faturamento: 'valor_bruto', prazo: '15_dfm', data_base: today, dias_agencia: '7',
    primeira_veiculacao: '', ultima_veiculacao: '', contato: '', responsavel_id: responsavelId, situacao: 'em_aberto',
    observacao: '', texto_legal: '', insercoes: [emptyInsercao(today)],
  }
}

function rowTotal(r: Insercao) {
  return parseMoney(r.valor) * (1 - parseMoney(r.desconto) / 100)
}

export function ImpressaForm({
  clientes, veiculos, members, defaultResponsavelId, today, redirectTo, initial, submitLabel = 'Gravar', onSubmit,
}: {
  clientes: ClienteOpt[]; veiculos: VeiculoOpt[]; members: MemberOpt[]
  defaultResponsavelId: string; today: string; redirectTo: string
  initial?: Partial<ImpressaValues>; submitLabel?: string
  onSubmit: (fd: FormData) => Promise<{ error?: string } | void>
}) {
  const router = useRouter()
  const [form, setForm] = useState<ImpressaValues>({ ...emptyValues(today, defaultResponsavelId), ...initial, insercoes: initial?.insercoes?.length ? initial.insercoes : [emptyInsercao(today)] })
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function set<K extends keyof ImpressaValues>(k: K, v: ImpressaValues[K]) { setForm(f => ({ ...f, [k]: v })) }
  function setRow(i: number, k: keyof Insercao, v: string) {
    setForm(f => ({ ...f, insercoes: f.insercoes.map((r, idx) => idx === i ? { ...r, [k]: v } : r) }))
  }
  function addRow() { setForm(f => ({ ...f, insercoes: [...f.insercoes, emptyInsercao(today)] })) }
  function delRow(i: number) { setForm(f => ({ ...f, insercoes: f.insercoes.filter((_, idx) => idx !== i) })) }

  const valor = useMemo(() => form.insercoes.reduce((s, r) => s + rowTotal(r), 0), [form.insercoes])
  const comissao = valor * (parseMoney(form.desconto_pct) / 100)
  const pagador = FATURAMENTO_PAGADOR[form.faturamento] ?? 'cliente'

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
    if (!form.titulo.trim()) { setError('Informe o título'); return }

    const fd = new FormData()
    const scalars: (keyof ImpressaValues)[] = ['workspace_id', 'campaign_id', 'veiculo_id', 'titulo', 'emissao', 'job', 'aut_veiculo', 'codigo_identificador', 'nota_fiscal', 'faturamento', 'prazo', 'data_base', 'dias_agencia', 'primeira_veiculacao', 'ultima_veiculacao', 'contato', 'responsavel_id', 'situacao', 'observacao', 'texto_legal']
    scalars.forEach(k => fd.set(k, String(form[k] ?? '')))
    fd.set('tipo', 'impressa_revista')
    fd.set('valor', String(valor))
    fd.set('desconto_pct', String(parseMoney(form.desconto_pct)))
    fd.set('redirect_to', redirectTo)
    fd.set('detalhe', JSON.stringify({ revista: form.revista, periodo: form.periodo, insercoes: form.insercoes }))

    startTransition(async () => {
      const res = await onSubmit(fd)
      if (res?.error) { setError(res.error); return }
    })
  }

  const clienteOptions = clientes.map(c => ({ value: c.id, label: c.name }))
  const veiculoOptions = veiculos.map(v => ({ value: v.id, label: v.name }))
  const memberOptions = members.map(m => ({ value: m.id, label: m.name }))

  return (
    <div className="p-6 max-w-5xl">
      <button onClick={() => router.back()} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition mb-4">
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>
      <h1 className="text-xl font-semibold text-gray-900 mb-5">{submitLabel === 'Gravar' ? 'Adicionar' : 'Editar'} Mídia Impressa (Revista)</h1>

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
          <div className="mt-4"><label className={labelCls}>Título <span className="text-red-500">*</span></label>
            <input value={form.titulo} onChange={e => set('titulo', e.target.value)} className={inputCls} required /></div>
        </div>

        {/* Anúncio */}
        <div className={cardCls}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Anúncio</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className={labelCls}>Revista</label><input value={form.revista} onChange={e => set('revista', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Período</label><input value={form.periodo} onChange={e => set('periodo', e.target.value)} className={inputCls} /></div>
          </div>
        </div>

        {/* Inserções */}
        <div className={cardCls}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Inserções</h3>
            <button type="button" onClick={addRow} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"><Plus className="w-3.5 h-3.5" /> Adicionar</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="text-xs font-medium text-gray-400 text-left">
                  <th className="px-1 py-1">Formato</th><th className="px-1 py-1 w-28">Mês</th><th className="px-1 py-1 w-20">Ano</th>
                  <th className="px-1 py-1 w-16">Ins.</th><th className="px-1 py-1">Edição</th><th className="px-1 py-1 w-32">Abrangência</th>
                  <th className="px-1 py-1">Determinação</th><th className="px-1 py-1 w-36">Data base</th><th className="px-1 py-1 w-28 text-right">Valor</th>
                  <th className="px-1 py-1 w-20 text-right">Desc.%</th><th className="px-1 py-1 w-28 text-right">Total</th><th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {form.insercoes.map((r, i) => (
                  <tr key={i}>
                    <td className="px-1 py-1"><input value={r.formato} onChange={e => setRow(i, 'formato', e.target.value)} className={cellCls} /></td>
                    <td className="px-1 py-1"><Select size="sm" value={r.mes} onChange={v => setRow(i, 'mes', v)} options={MESES} /></td>
                    <td className="px-1 py-1"><Select size="sm" value={r.ano} onChange={v => setRow(i, 'ano', v)} options={ANOS} /></td>
                    <td className="px-1 py-1"><input value={r.insercoes} onChange={e => setRow(i, 'insercoes', e.target.value)} className={cn(cellCls, 'text-right')} /></td>
                    <td className="px-1 py-1"><input value={r.edicao} onChange={e => setRow(i, 'edicao', e.target.value)} className={cellCls} /></td>
                    <td className="px-1 py-1"><Select size="sm" value={r.abrangencia} onChange={v => setRow(i, 'abrangencia', v)} options={MIDIA_ABRANGENCIA_OPTIONS} /></td>
                    <td className="px-1 py-1"><input value={r.determinacao} onChange={e => setRow(i, 'determinacao', e.target.value)} className={cellCls} /></td>
                    <td className="px-1 py-1"><input type="date" value={r.data_base} onChange={e => setRow(i, 'data_base', e.target.value)} className={cellCls} /></td>
                    <td className="px-1 py-1"><input inputMode="decimal" value={r.valor} onChange={e => setRow(i, 'valor', e.target.value)} placeholder="0,00" className={cn(cellCls, 'text-right')} /></td>
                    <td className="px-1 py-1"><input inputMode="decimal" value={r.desconto} onChange={e => setRow(i, 'desconto', e.target.value)} className={cn(cellCls, 'text-right')} /></td>
                    <td className="px-1 py-1 text-right text-gray-900 font-medium whitespace-nowrap">{formatBRL(rowTotal(r))}</td>
                    <td className="px-1 py-1 text-right">{form.insercoes.length > 1 && <button aria-label="Remover" type="button" onClick={() => delRow(i)} className="text-gray-300 hover:text-red-500 transition"><Trash2 className="w-3.5 h-3.5" /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end mt-2 text-sm"><span className="text-gray-500">Valor:&nbsp;</span><span className="font-semibold text-gray-900">{formatBRL(valor)}</span></div>
        </div>

        {/* Preços / financeiro */}
        <div className={cardCls}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div><label className={labelCls}>Desconto Padrão Agência (%)</label><input inputMode="decimal" value={form.desconto_pct} onChange={e => set('desconto_pct', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Faturamento</label><Select value={form.faturamento} onChange={v => set('faturamento', v)} options={MIDIA_FATURAMENTO_OPTIONS} /></div>
            <div className="flex items-end"><p className="text-sm text-gray-600">Comissão: <strong className="text-emerald-600">{formatBRL(comissao)}</strong> <span className="text-gray-400">({pagador === 'veiculo' ? 'veículo' : 'cliente'})</span></p></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
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
          <button aria-label="Salvar" type="submit" disabled={isPending} className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition">
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
