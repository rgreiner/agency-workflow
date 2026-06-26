'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import {
  MIDIA_TIPO_OPTIONS, MIDIA_FATURAMENTO_OPTIONS, MIDIA_PRAZO_OPTIONS,
  MIDIA_ABRANGENCIA_OPTIONS, MIDIA_SITUACAO_OPTIONS, FATURAMENTO_PAGADOR,
  formatBRL, parseMoney,
} from '@/lib/midia'

export interface ClienteOpt { id: string; name: string; campaigns: { id: string; name: string }[] }
export interface VeiculoOpt { id: string; name: string; commission_pct: number | null }
export interface MemberOpt { id: string; name: string }

export interface MidiaValues {
  workspace_id: string; campaign_id: string; veiculo_id: string; tipo: string; titulo: string
  emissao: string; job: string; aut_veiculo: string; codigo_identificador: string; nota_fiscal: string
  pecas: string; praca: string; abrangencia: string
  valor: string; desconto_pct: string; faturamento: string; prazo: string; data_base: string; dias_agencia: string
  primeira_veiculacao: string; ultima_veiculacao: string; contato: string; responsavel_id: string; situacao: string
  observacao: string; texto_legal: string
}

const inputCls =
  'w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'
const cardCls = 'bg-white rounded-2xl border border-gray-200 p-5'

function emptyValues(today: string, defaultResponsavelId: string): MidiaValues {
  return {
    workspace_id: '', campaign_id: '', veiculo_id: '', tipo: 'impressa_jornal', titulo: '',
    emissao: today, job: '', aut_veiculo: '', codigo_identificador: '', nota_fiscal: '',
    pecas: '', praca: '', abrangencia: 'local',
    valor: '', desconto_pct: '20', faturamento: 'valor_bruto', prazo: '15_dfm', data_base: today, dias_agencia: '7',
    primeira_veiculacao: '', ultima_veiculacao: '', contato: '', responsavel_id: defaultResponsavelId, situacao: 'em_aberto',
    observacao: '', texto_legal: '',
  }
}

export function MidiaForm({
  clientes, veiculos, members, defaultResponsavelId, today, initial, submitLabel = 'Gravar', onSubmit,
}: {
  clientes: ClienteOpt[]
  veiculos: VeiculoOpt[]
  members: MemberOpt[]
  defaultResponsavelId: string
  today: string
  initial?: Partial<MidiaValues>
  submitLabel?: string
  onSubmit: (fd: FormData) => Promise<{ error?: string } | void>
}) {
  const router = useRouter()
  const [form, setForm] = useState<MidiaValues>({ ...emptyValues(today, defaultResponsavelId), ...initial })
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function set<K extends keyof MidiaValues>(key: K, value: MidiaValues[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  const campanhaOptions = useMemo(() => {
    const c = clientes.find(c => c.id === form.workspace_id)
    return (c?.campaigns ?? []).map(cp => ({ value: cp.id, label: cp.name }))
  }, [clientes, form.workspace_id])

  // Comissão da agência = valor × desconto% (é o que vai pro Financeiro quando faturado).
  const valorNum = parseMoney(form.valor)
  const descNum = parseMoney(form.desconto_pct)
  const comissao = valorNum * (descNum / 100)
  const pagador = FATURAMENTO_PAGADOR[form.faturamento] ?? 'cliente'

  function onClienteChange(v: string) {
    setForm(f => ({ ...f, workspace_id: v, campaign_id: '' }))
  }
  function onVeiculoChange(v: string) {
    const veic = veiculos.find(x => x.id === v)
    setForm(f => ({
      ...f, veiculo_id: v,
      // puxa o desconto padrão do veículo (usuário pode sobrescrever)
      desconto_pct: veic?.commission_pct != null ? String(veic.commission_pct).replace('.', ',') : f.desconto_pct,
    }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.workspace_id) { setError('Selecione o cliente'); return }
    if (!form.veiculo_id) { setError('Selecione o veículo'); return }
    if (!form.titulo.trim()) { setError('Informe o título'); return }

    const fd = new FormData()
    Object.entries(form).forEach(([k, v]) => fd.set(k, v))
    // valores numéricos com ponto decimal
    fd.set('valor', String(valorNum))
    fd.set('desconto_pct', String(descNum))
    fd.set('dias_agencia', String(parseInt(form.dias_agencia || '0', 10) || 0))

    startTransition(async () => {
      const res = await onSubmit(fd)
      if (res?.error) { setError(res.error); return }
    })
  }

  const clienteOptions = clientes.map(c => ({ value: c.id, label: c.name }))
  const veiculoOptions = veiculos.map(v => ({ value: v.id, label: v.name }))
  const memberOptions = members.map(m => ({ value: m.id, label: m.name }))

  return (
    <div className="p-6 max-w-4xl">
      <button onClick={() => router.back()}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition mb-4">
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>
      <h1 className="text-xl font-semibold text-gray-900 mb-5">Adicionar Mídia Simplificada</h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        {/* Tipo */}
        <div className={cardCls}>
          <label className={labelCls}>Tipo</label>
          <div className="max-w-md">
            <Select value={form.tipo} onChange={v => set('tipo', v)} options={MIDIA_TIPO_OPTIONS} />
          </div>
        </div>

        {/* Cabeçalho */}
        <div className={cardCls}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Cliente <span className="text-red-500">*</span></label>
              <Select value={form.workspace_id} onChange={onClienteChange} options={clienteOptions} placeholder="Selecionar cliente" />
            </div>
            <div>
              <label className={labelCls}>Campanha</label>
              <Select value={form.campaign_id} onChange={v => set('campaign_id', v)} options={campanhaOptions}
                placeholder={form.workspace_id ? 'Selecionar' : 'Escolha o cliente'} />
            </div>
            <div>
              <label className={labelCls}>Veículo <span className="text-red-500">*</span></label>
              <Select value={form.veiculo_id} onChange={onVeiculoChange} options={veiculoOptions} placeholder="Selecionar veículo" />
            </div>
            <div>
              <label className={labelCls}>Emissão</label>
              <input type="date" value={form.emissao} onChange={e => set('emissao', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Job</label>
              <input type="text" value={form.job} onChange={e => set('job', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Aut. no Veículo</label>
              <input type="text" value={form.aut_veiculo} onChange={e => set('aut_veiculo', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Código Identificador</label>
              <input type="text" value={form.codigo_identificador} onChange={e => set('codigo_identificador', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Nota Fiscal</label>
              <input type="text" value={form.nota_fiscal} onChange={e => set('nota_fiscal', e.target.value)} className={inputCls} />
            </div>
          </div>
          <div className="mt-4">
            <label className={labelCls}>Título <span className="text-red-500">*</span></label>
            <input type="text" value={form.titulo} onChange={e => set('titulo', e.target.value)} className={inputCls} required />
          </div>
        </div>

        {/* Conteúdo */}
        <div className={cardCls}>
          <label className={labelCls}>Peças</label>
          <textarea rows={3} value={form.pecas} onChange={e => set('pecas', e.target.value)} className={cn(inputCls, 'resize-none')} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <div>
              <label className={labelCls}>Praça</label>
              <input type="text" value={form.praca} onChange={e => set('praca', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Abrangência</label>
              <Select value={form.abrangencia} onChange={v => set('abrangencia', v)} options={MIDIA_ABRANGENCIA_OPTIONS} />
            </div>
          </div>
        </div>

        {/* Valores */}
        <div className={cardCls}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Valor (R$)</label>
              <input type="text" inputMode="decimal" value={form.valor} onChange={e => set('valor', e.target.value)} placeholder="0,00" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Desconto Padrão Agência (%)</label>
              <input type="text" inputMode="decimal" value={form.desconto_pct} onChange={e => set('desconto_pct', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Faturamento</label>
              <Select value={form.faturamento} onChange={v => set('faturamento', v)} options={MIDIA_FATURAMENTO_OPTIONS} />
            </div>
          </div>

          <div className="mt-3 rounded-xl bg-indigo-50 border border-indigo-100 px-4 py-3 text-sm text-indigo-900">
            Comissão da agência: <strong>{formatBRL(comissao)}</strong>
            <span className="text-indigo-700"> — paga pelo {pagador === 'cliente' ? 'cliente' : 'veículo'}. Vira lançamento no Financeiro quando a situação for <strong>Faturado</strong>.</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
            <div>
              <label className={labelCls}>Prazo</label>
              <Select value={form.prazo} onChange={v => set('prazo', v)} options={MIDIA_PRAZO_OPTIONS} />
            </div>
            <div>
              <label className={labelCls}>Data Base</label>
              <input type="date" value={form.data_base} onChange={e => set('data_base', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Dias Agência</label>
              <input type="number" value={form.dias_agencia} onChange={e => set('dias_agencia', e.target.value)} className={inputCls} />
            </div>
          </div>
        </div>

        {/* Veiculação & status */}
        <div className={cardCls}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Primeira Veiculação</label>
              <input type="date" value={form.primeira_veiculacao} onChange={e => set('primeira_veiculacao', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Última Veiculação</label>
              <input type="date" value={form.ultima_veiculacao} onChange={e => set('ultima_veiculacao', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Contato</label>
              <input type="text" value={form.contato} onChange={e => set('contato', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Responsável</label>
              <Select value={form.responsavel_id} onChange={v => set('responsavel_id', v)} options={memberOptions} placeholder="Selecionar" />
            </div>
            <div>
              <label className={labelCls}>Situação</label>
              <Select value={form.situacao} onChange={v => set('situacao', v)} options={MIDIA_SITUACAO_OPTIONS} />
            </div>
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
          <button aria-label="Salvar" type="submit" disabled={isPending}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition">
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
