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

export interface Localizacao { endereco: string; cidade: string }
export interface ExternaValues {
  workspace_id: string; campaign_id: string; veiculo_id: string; titulo: string
  emissao: string; job: string; aut_veiculo: string; codigo_identificador: string; nota_fiscal: string
  mes: string; ano: string; bisemana: string; periodo: string; praca: string; abrangencia: string; especie: string
  negociacao: string; producao_tipo: string; pedido_producao: string
  custo: string; desconto_exibicao: string
  desconto_pct: string; faturamento: string; prazo: string; data_base: string; dias_agencia: string
  primeira_veiculacao: string; ultima_veiculacao: string; contato: string; responsavel_id: string; situacao: string
  observacao: string; texto_legal: string
  localizacoes: Localizacao[]
}

const MESES = [
  { value: '1', label: 'Janeiro' }, { value: '2', label: 'Fevereiro' }, { value: '3', label: 'Março' },
  { value: '4', label: 'Abril' }, { value: '5', label: 'Maio' }, { value: '6', label: 'Junho' },
  { value: '7', label: 'Julho' }, { value: '8', label: 'Agosto' }, { value: '9', label: 'Setembro' },
  { value: '10', label: 'Outubro' }, { value: '11', label: 'Novembro' }, { value: '12', label: 'Dezembro' },
]
const ANOS = ['2024', '2025', '2026', '2027'].map(a => ({ value: a, label: a }))
const ESPECIE = ['Outdoor', 'Busdoor', 'Painel', 'LED', 'Mobiliário Urbano', 'Outro'].map(e => ({ value: e, label: e }))
const NEGOCIACAO = [{ value: 'custos_normais', label: 'Custos Normais' }, { value: 'valor_fechado', label: 'Valor Fechado' }]
const PRODUCAO_TIPO = [{ value: 'no_veiculo', label: 'No Veículo' }, { value: 'de_terceiros', label: 'De Terceiros' }]

const inputCls = 'w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'
const cardCls = 'bg-white rounded-2xl border border-gray-200 p-5'

const newLoc = (): Localizacao => ({ endereco: '', cidade: '' })
function emptyValues(today: string, responsavelId: string): ExternaValues {
  const [y, m] = today.split('-')
  return {
    workspace_id: '', campaign_id: '', veiculo_id: '', titulo: '',
    emissao: today, job: '', aut_veiculo: '', codigo_identificador: '', nota_fiscal: '',
    mes: String(Number(m)), ano: y, bisemana: 'outro', periodo: '', praca: '', abrangencia: 'estadual', especie: 'Outdoor',
    negociacao: 'custos_normais', producao_tipo: 'no_veiculo', pedido_producao: '',
    custo: '', desconto_exibicao: '0',
    desconto_pct: '20', faturamento: 'valor_bruto', prazo: '15_dfm', data_base: today, dias_agencia: '7',
    primeira_veiculacao: '', ultima_veiculacao: '', contato: '', responsavel_id: responsavelId, situacao: 'em_aberto',
    observacao: '', texto_legal: '', localizacoes: [newLoc()],
  }
}

export function ExternaForm({
  clientes, veiculos, members, defaultResponsavelId, today, redirectTo, initial, submitLabel = 'Gravar', onSubmit,
}: {
  clientes: ClienteOpt[]; veiculos: VeiculoOpt[]; members: MemberOpt[]
  defaultResponsavelId: string; today: string; redirectTo: string
  initial?: Partial<ExternaValues>; submitLabel?: string
  onSubmit: (fd: FormData) => Promise<{ error?: string } | void>
}) {
  const router = useRouter()
  const [form, setForm] = useState<ExternaValues>({
    ...emptyValues(today, defaultResponsavelId), ...initial,
    localizacoes: initial?.localizacoes?.length ? initial.localizacoes : [newLoc()],
  })
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function set<K extends keyof ExternaValues>(k: K, v: ExternaValues[K]) { setForm(f => ({ ...f, [k]: v })) }
  const setLoc = (i: number, k: keyof Localizacao, v: string) => setForm(f => ({ ...f, localizacoes: f.localizacoes.map((l, idx) => idx === i ? { ...l, [k]: v } : l) }))
  const addLoc = () => setForm(f => ({ ...f, localizacoes: [...f.localizacoes, newLoc()] }))
  const delLoc = (i: number) => setForm(f => ({ ...f, localizacoes: f.localizacoes.filter((_, idx) => idx !== i) }))

  const valor = parseMoney(form.custo) * (1 - parseMoney(form.desconto_exibicao) / 100)
  const comissao = valor * (parseMoney(form.desconto_pct) / 100)
  const pagador = FATURAMENTO_PAGADOR[form.faturamento] ?? 'cliente'

  const bisemanaOptions = useMemo(() => {
    const yy = (form.ano || '2026').slice(-2)
    return [{ value: 'outro', label: 'Outro' }, ...Array.from({ length: 26 }, (_, i) => { const n = (i + 1) * 2; return { value: `${n}/${yy}`, label: `${n}/${yy}` } })]
  }, [form.ano])

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
    const scalars: (keyof ExternaValues)[] = ['workspace_id', 'campaign_id', 'veiculo_id', 'titulo', 'emissao', 'job', 'aut_veiculo', 'codigo_identificador', 'nota_fiscal', 'praca', 'abrangencia', 'faturamento', 'prazo', 'data_base', 'dias_agencia', 'primeira_veiculacao', 'ultima_veiculacao', 'contato', 'responsavel_id', 'situacao', 'observacao', 'texto_legal']
    scalars.forEach(k => fd.set(k, String(form[k] ?? '')))
    fd.set('tipo', 'externa')
    fd.set('valor', String(valor))
    fd.set('desconto_pct', String(parseMoney(form.desconto_pct)))
    fd.set('redirect_to', redirectTo)
    fd.set('detalhe', JSON.stringify({
      mes: form.mes, ano: form.ano, bisemana: form.bisemana, periodo: form.periodo, especie: form.especie,
      negociacao: form.negociacao, producao_tipo: form.producao_tipo, pedido_producao: form.pedido_producao,
      custo: form.custo, desconto_exibicao: form.desconto_exibicao, localizacoes: form.localizacoes,
    }))

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
      <h1 className="text-xl font-semibold text-gray-900 mb-5">{submitLabel === 'Gravar' ? 'Adicionar' : 'Editar'} Mídia Externa</h1>

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
        </div>

        {/* Período / praça */}
        <div className={cardCls}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div><label className={labelCls}>Mês</label><Select value={form.mes} onChange={v => set('mes', v)} options={MESES} /></div>
            <div><label className={labelCls}>Ano</label><Select value={form.ano} onChange={v => set('ano', v)} options={ANOS} /></div>
            <div><label className={labelCls}>Bisemana</label><Select value={form.bisemana} onChange={v => set('bisemana', v)} options={bisemanaOptions} /></div>
            <div><label className={labelCls}>Período</label><input value={form.periodo} onChange={e => set('periodo', e.target.value)} placeholder="13/07/2026 até 26/07/2026" className={inputCls} /></div>
            <div><label className={labelCls}>Praça</label><input value={form.praca} onChange={e => set('praca', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Abrangência</label><Select value={form.abrangencia} onChange={v => set('abrangencia', v)} options={MIDIA_ABRANGENCIA_OPTIONS} /></div>
            <div><label className={labelCls}>Espécie</label><Select value={form.especie} onChange={v => set('especie', v)} options={ESPECIE} /></div>
          </div>
        </div>

        {/* Localizações */}
        <div className={cardCls}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Localizações</h3>
            <button type="button" onClick={addLoc} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"><Plus className="w-3.5 h-3.5" /> Adicionar</button>
          </div>
          <div className="space-y-2">
            {form.localizacoes.map((l, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input value={l.endereco} onChange={e => setLoc(i, 'endereco', e.target.value)} placeholder="Endereço / código do ponto" className={inputCls} />
                <input value={l.cidade} onChange={e => setLoc(i, 'cidade', e.target.value)} placeholder="Cidade" className={inputCls} />
                {form.localizacoes.length > 1 && <button type="button" onClick={() => delLoc(i)} className="text-gray-300 hover:text-red-500 transition shrink-0"><Trash2 className="w-4 h-4" /></button>}
              </div>
            ))}
          </div>
        </div>

        {/* Negociação + Produção */}
        <div className={cardCls}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div><label className={labelCls}>Negociação</label><Select value={form.negociacao} onChange={v => set('negociacao', v)} options={NEGOCIACAO} /></div>
            <div><label className={labelCls}>Produção — Tipo</label><Select value={form.producao_tipo} onChange={v => set('producao_tipo', v)} options={PRODUCAO_TIPO} /></div>
            <div><label className={labelCls}>Pedido de Produção</label><input value={form.pedido_producao} onChange={e => set('pedido_producao', e.target.value)} className={inputCls} /></div>
          </div>
        </div>

        {/* Custos de exibição / financeiro */}
        <div className={cardCls}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Custos de Exibição</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div><label className={labelCls}>Custo (R$)</label><input inputMode="decimal" value={form.custo} onChange={e => set('custo', e.target.value)} placeholder="0,00" className={inputCls} /></div>
            <div><label className={labelCls}>Desconto exibição (%)</label><input inputMode="decimal" value={form.desconto_exibicao} onChange={e => set('desconto_exibicao', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Desconto Padrão Agência (%)</label><input inputMode="decimal" value={form.desconto_pct} onChange={e => set('desconto_pct', e.target.value)} className={inputCls} /></div>
          </div>
          <div className="mt-3 rounded-xl bg-indigo-50 border border-indigo-100 px-4 py-3 text-sm text-indigo-900">
            Valor: <strong>{formatBRL(valor)}</strong> · Comissão da agência: <strong>{formatBRL(comissao)}</strong>
            <span className="text-indigo-700"> (paga pelo {pagador === 'veiculo' ? 'veículo' : 'cliente'})</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
            <div><label className={labelCls}>Faturamento</label><Select value={form.faturamento} onChange={v => set('faturamento', v)} options={MIDIA_FATURAMENTO_OPTIONS} /></div>
            <div><label className={labelCls}>Prazo</label><Select value={form.prazo} onChange={v => set('prazo', v)} options={MIDIA_PRAZO_OPTIONS} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Data Base</label><input type="date" value={form.data_base} onChange={e => set('data_base', e.target.value)} className={inputCls} /></div>
              <div><label className={labelCls}>Dias Agência</label><input type="number" value={form.dias_agencia} onChange={e => set('dias_agencia', e.target.value)} className={inputCls} /></div>
            </div>
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
