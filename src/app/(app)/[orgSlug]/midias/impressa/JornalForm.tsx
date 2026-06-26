'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import {
  MIDIA_FATURAMENTO_OPTIONS, MIDIA_PRAZO_OPTIONS, MIDIA_ABRANGENCIA_OPTIONS,
  MIDIA_SITUACAO_OPTIONS, FATURAMENTO_PAGADOR, formatBRL, parseMoney,
} from '@/lib/midia'
import type { ClienteOpt, VeiculoOpt, MemberOpt } from '../simplificada/MidiaForm'

export interface JornalValues {
  workspace_id: string; campaign_id: string; veiculo_id: string; titulo: string
  emissao: string; job: string; aut_veiculo: string; codigo_identificador: string; nota_fiscal: string
  secao: string; tipo_anuncio: string; determinacao: string; em: string; colunas: string; cm: string
  mes: string; ano: string; entregar_por: string; ja_publicado_em: string; cores: string; edicao: string
  abrangencia: string; observacao: string
  negociacao: string; valor: string
  desconto_pct: string; faturamento: string; prazo: string; data_base: string; dias_agencia: string
  primeira_veiculacao: string; ultima_veiculacao: string; contato: string; responsavel_id: string; situacao: string
  texto_legal: string
  dias: Record<string, string>
}

const MESES = [
  { value: '1', label: 'Janeiro' }, { value: '2', label: 'Fevereiro' }, { value: '3', label: 'Março' },
  { value: '4', label: 'Abril' }, { value: '5', label: 'Maio' }, { value: '6', label: 'Junho' },
  { value: '7', label: 'Julho' }, { value: '8', label: 'Agosto' }, { value: '9', label: 'Setembro' },
  { value: '10', label: 'Outubro' }, { value: '11', label: 'Novembro' }, { value: '12', label: 'Dezembro' },
]
const ANOS = ['2024', '2025', '2026', '2027'].map(a => ({ value: a, label: a }))
const NEGOCIACAO = [{ value: 'valor_fechado', label: 'Valor Fechado' }, { value: 'custos_normais', label: 'Custos Normais' }]
const WD = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

const inputCls = 'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'
const cardCls = 'bg-white rounded-2xl border border-gray-200 p-5'

function emptyValues(today: string, responsavelId: string): JornalValues {
  const [y, m] = today.split('-')
  return {
    workspace_id: '', campaign_id: '', veiculo_id: '', titulo: '',
    emissao: today, job: '', aut_veiculo: '', codigo_identificador: '', nota_fiscal: '',
    secao: '', tipo_anuncio: '', determinacao: '', em: '', colunas: '', cm: '',
    mes: String(Number(m)), ano: y, entregar_por: '', ja_publicado_em: '', cores: '', edicao: '',
    abrangencia: 'estadual', observacao: '',
    negociacao: 'valor_fechado', valor: '',
    desconto_pct: '20', faturamento: 'valor_bruto', prazo: '15_dfm', data_base: today, dias_agencia: '7',
    primeira_veiculacao: '', ultima_veiculacao: '', contato: '', responsavel_id: responsavelId, situacao: 'em_aberto',
    texto_legal: '', dias: {},
  }
}

export function JornalForm({
  clientes, veiculos, members, defaultResponsavelId, today, redirectTo, initial, submitLabel = 'Gravar', onSubmit,
}: {
  clientes: ClienteOpt[]; veiculos: VeiculoOpt[]; members: MemberOpt[]
  defaultResponsavelId: string; today: string; redirectTo: string
  initial?: Partial<JornalValues>; submitLabel?: string
  onSubmit: (fd: FormData) => Promise<{ error?: string } | void>
}) {
  const router = useRouter()
  const [form, setForm] = useState<JornalValues>({ ...emptyValues(today, defaultResponsavelId), ...initial, dias: initial?.dias ?? {} })
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function set<K extends keyof JornalValues>(k: K, v: JornalValues[K]) { setForm(f => ({ ...f, [k]: v })) }

  const diasNoMes = useMemo(() => new Date(Number(form.ano), Number(form.mes), 0).getDate() || 30, [form.mes, form.ano])
  const totalAnuncios = useMemo(
    () => Object.values(form.dias).reduce((s, v) => s + (parseInt(v || '0', 10) || 0), 0),
    [form.dias],
  )
  function setDia(d: number, v: string) {
    setForm(f => {
      const dias = { ...f.dias }
      if (!v || v === '0') delete dias[d]; else dias[d] = v
      return { ...f, dias }
    })
  }

  const valor = parseMoney(form.valor)
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
    const scalars: (keyof JornalValues)[] = ['workspace_id', 'campaign_id', 'veiculo_id', 'titulo', 'emissao', 'job', 'aut_veiculo', 'codigo_identificador', 'nota_fiscal', 'abrangencia', 'faturamento', 'prazo', 'data_base', 'dias_agencia', 'primeira_veiculacao', 'ultima_veiculacao', 'contato', 'responsavel_id', 'situacao', 'observacao', 'texto_legal']
    scalars.forEach(k => fd.set(k, String(form[k] ?? '')))
    fd.set('tipo', 'impressa_jornal')
    fd.set('valor', String(valor))
    fd.set('desconto_pct', String(parseMoney(form.desconto_pct)))
    fd.set('redirect_to', redirectTo)
    fd.set('detalhe', JSON.stringify({
      secao: form.secao, tipo_anuncio: form.tipo_anuncio, determinacao: form.determinacao, em: form.em,
      colunas: form.colunas, cm: form.cm, mes: form.mes, ano: form.ano,
      entregar_por: form.entregar_por, ja_publicado_em: form.ja_publicado_em, cores: form.cores, edicao: form.edicao,
      negociacao: form.negociacao, dias: form.dias, total_anuncios: totalAnuncios,
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
      <h1 className="text-xl font-semibold text-gray-900 mb-5">{submitLabel === 'Gravar' ? 'Adicionar' : 'Editar'} Mídia Impressa (Jornal)</h1>

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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div><label className={labelCls}>Seção/Retranca</label><input value={form.secao} onChange={e => set('secao', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Tipo</label><input value={form.tipo_anuncio} onChange={e => set('tipo_anuncio', e.target.value)} placeholder="Ex.: Geral" className={inputCls} /></div>
            <div><label className={labelCls}>Determinação</label><input value={form.determinacao} onChange={e => set('determinacao', e.target.value)} placeholder="Ex.: Meia Página" className={inputCls} /></div>
            <div><label className={labelCls}>Em</label><input value={form.em} onChange={e => set('em', e.target.value)} placeholder="Ex.: Noticiário" className={inputCls} /></div>
            <div><label className={labelCls}>Colunas</label><input inputMode="decimal" value={form.colunas} onChange={e => set('colunas', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Cm</label><input inputMode="decimal" value={form.cm} onChange={e => set('cm', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Mês</label><Select value={form.mes} onChange={v => set('mes', v)} options={MESES} /></div>
            <div><label className={labelCls}>Ano</label><Select value={form.ano} onChange={v => set('ano', v)} options={ANOS} /></div>
          </div>

          {/* Grade de dias */}
          <div className="mt-4 overflow-x-auto">
            <div className="inline-flex gap-px">
              {Array.from({ length: diasNoMes }, (_, idx) => {
                const d = idx + 1
                const wd = WD[new Date(Number(form.ano), Number(form.mes) - 1, d).getDay()]
                const isWeekend = wd === 'D' || wd === 'S' && new Date(Number(form.ano), Number(form.mes) - 1, d).getDay() === 6
                return (
                  <div key={d} className="w-9 text-center">
                    <div className={cn('text-[10px] leading-tight py-0.5 rounded-t', isWeekend ? 'bg-gray-200 text-gray-600' : 'bg-gray-100 text-gray-400')}>
                      <div className="font-medium text-gray-600">{d}</div><div>{wd}</div>
                    </div>
                    <input value={form.dias[d] ?? ''} onChange={e => setDia(d, e.target.value)}
                      className="w-9 h-9 text-center text-xs border border-gray-200 rounded-b focus:outline-none focus:ring-1 focus:ring-orange-500" />
                  </div>
                )
              })}
            </div>
            <p className="text-sm text-gray-500 mt-2">Total de anúncios: <strong className="text-gray-900">{totalAnuncios}</strong></p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mt-4">
            <div><label className={labelCls}>Entregar por</label><input value={form.entregar_por} onChange={e => set('entregar_por', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Já publicado em</label><input type="date" value={form.ja_publicado_em} onChange={e => set('ja_publicado_em', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Cores</label><input value={form.cores} onChange={e => set('cores', e.target.value)} placeholder="Ex.: Policromia" className={inputCls} /></div>
            <div><label className={labelCls}>Edição</label><input value={form.edicao} onChange={e => set('edicao', e.target.value)} placeholder="Ex.: Estado" className={inputCls} /></div>
            <div><label className={labelCls}>Abrangência</label><Select value={form.abrangencia} onChange={v => set('abrangencia', v)} options={MIDIA_ABRANGENCIA_OPTIONS} /></div>
            <div className="sm:col-span-3"><label className={labelCls}>Observação do anúncio</label><input value={form.observacao} onChange={e => set('observacao', e.target.value)} className={inputCls} /></div>
          </div>
        </div>

        {/* Preços / financeiro */}
        <div className={cardCls}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div><label className={labelCls}>Negociação</label><Select value={form.negociacao} onChange={v => set('negociacao', v)} options={NEGOCIACAO} /></div>
            <div><label className={labelCls}>Valor (R$)</label><input inputMode="decimal" value={form.valor} onChange={e => set('valor', e.target.value)} placeholder="0,00" className={inputCls} /></div>
            <div><label className={labelCls}>Desconto Padrão Agência (%)</label><input inputMode="decimal" value={form.desconto_pct} onChange={e => set('desconto_pct', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Faturamento</label><Select value={form.faturamento} onChange={v => set('faturamento', v)} options={MIDIA_FATURAMENTO_OPTIONS} /></div>
            <div className="sm:col-span-2 flex items-end"><p className="text-sm text-gray-600">Comissão: <strong className="text-emerald-600">{formatBRL(comissao)}</strong> <span className="text-gray-400">({pagador === 'veiculo' ? 'veículo' : 'cliente'})</span></p></div>
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

        {/* Texto legal */}
        <div className={cardCls}>
          <label className={labelCls}>Texto Legal</label>
          <textarea rows={3} value={form.texto_legal} onChange={e => set('texto_legal', e.target.value)} className={cn(inputCls, 'resize-none')} />
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
