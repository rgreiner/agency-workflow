'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, Loader2, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { TextoPadraoField } from '@/components/ui/TextoPadraoField'
import {
  MIDIA_FATURAMENTO_OPTIONS, MIDIA_PRAZO_OPTIONS, MIDIA_ABRANGENCIA_OPTIONS,
  MIDIA_SITUACAO_OPTIONS, FATURAMENTO_PAGADOR, formatBRL, parseMoney,
} from '@/lib/midia'
import type { ClienteOpt, VeiculoOpt, MemberOpt } from '../simplificada/MidiaForm'

export interface PecaDig { peca: string; tipo: string; titulo: string; formato: string }
export interface InsercaoDig { peca: string; local: string; tipo: string; descricao: string; quantidade: string; valor: string; desconto: string }
export interface DigitalValues {
  workspace_id: string; campaign_id: string; veiculo_id: string; titulo: string
  emissao: string; job: string; aut_veiculo: string; codigo_identificador: string; nota_fiscal: string
  praca: string; abrangencia: string
  desconto_pct: string; faturamento: string; prazo: string; data_base: string; dias_agencia: string
  primeira_veiculacao: string; ultima_veiculacao: string; contato: string; responsavel_id: string; situacao: string
  observacao: string; texto_legal: string
  pecas: PecaDig[]; insercoes: InsercaoDig[]
}

const inputCls = 'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent'
const cellCls = 'w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'
const cardCls = 'bg-white rounded-2xl border border-gray-200 p-5'

const newPeca = (): PecaDig => ({ peca: 'A', tipo: 'Vídeo', titulo: '', formato: '' })
const newInsercao = (): InsercaoDig => ({ peca: 'A', local: '', tipo: 'CPC', descricao: '', quantidade: '1', valor: '', desconto: '0' })

function emptyValues(today: string, responsavelId: string): DigitalValues {
  return {
    workspace_id: '', campaign_id: '', veiculo_id: '', titulo: '',
    emissao: today, job: '', aut_veiculo: '', codigo_identificador: '', nota_fiscal: '',
    praca: '', abrangencia: 'estadual',
    desconto_pct: '20', faturamento: 'liquido_contra_cliente', prazo: '15_dfm', data_base: today, dias_agencia: '7',
    primeira_veiculacao: '', ultima_veiculacao: '', contato: '', responsavel_id: responsavelId, situacao: 'em_aberto',
    observacao: '', texto_legal: '', pecas: [newPeca()], insercoes: [newInsercao()],
  }
}

const rowTotal = (r: InsercaoDig) => (parseInt(r.quantidade || '1', 10) || 1) * parseMoney(r.valor) * (1 - parseMoney(r.desconto) / 100)

export function DigitalForm({
  clientes, veiculos, members, defaultResponsavelId, today, redirectTo, initial, submitLabel = 'Gravar', defaultTextoLegal = '', onSubmit,
}: {
  clientes: ClienteOpt[]; veiculos: VeiculoOpt[]; members: MemberOpt[]
  defaultResponsavelId: string; today: string; redirectTo: string
  initial?: Partial<DigitalValues>; submitLabel?: string; defaultTextoLegal?: string
  onSubmit: (fd: FormData) => Promise<{ error?: string } | void>
}) {
  const router = useRouter()
  const [form, setForm] = useState<DigitalValues>({
    ...emptyValues(today, defaultResponsavelId), ...initial, texto_legal: initial?.texto_legal || defaultTextoLegal,
    pecas: initial?.pecas?.length ? initial.pecas : [newPeca()],
    insercoes: initial?.insercoes?.length ? initial.insercoes : [newInsercao()],
  })
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function set<K extends keyof DigitalValues>(k: K, v: DigitalValues[K]) { setForm(f => ({ ...f, [k]: v })) }
  const setPeca = (i: number, k: keyof PecaDig, v: string) => setForm(f => ({ ...f, pecas: f.pecas.map((p, idx) => idx === i ? { ...p, [k]: v } : p) }))
  const addPeca = () => setForm(f => ({ ...f, pecas: [...f.pecas, newPeca()] }))
  const delPeca = (i: number) => setForm(f => ({ ...f, pecas: f.pecas.filter((_, idx) => idx !== i) }))
  const setIns = (i: number, k: keyof InsercaoDig, v: string) => setForm(f => ({ ...f, insercoes: f.insercoes.map((r, idx) => idx === i ? { ...r, [k]: v } : r) }))
  const addIns = () => setForm(f => ({ ...f, insercoes: [...f.insercoes, newInsercao()] }))
  const delIns = (i: number) => setForm(f => ({ ...f, insercoes: f.insercoes.filter((_, idx) => idx !== i) }))

  const valor = useMemo(() => form.insercoes.reduce((s, r) => s + rowTotal(r), 0), [form.insercoes])
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
    if (!form.titulo.trim()) { setError('Informe o título'); return }

    const fd = new FormData()
    const scalars: (keyof DigitalValues)[] = ['workspace_id', 'campaign_id', 'veiculo_id', 'titulo', 'emissao', 'job', 'aut_veiculo', 'codigo_identificador', 'nota_fiscal', 'praca', 'abrangencia', 'faturamento', 'prazo', 'data_base', 'dias_agencia', 'primeira_veiculacao', 'ultima_veiculacao', 'contato', 'responsavel_id', 'situacao', 'observacao', 'texto_legal']
    scalars.forEach(k => fd.set(k, String(form[k] ?? '')))
    fd.set('tipo', 'digital')
    fd.set('valor', String(valor))
    fd.set('desconto_pct', String(parseMoney(form.desconto_pct)))
    fd.set('redirect_to', redirectTo)
    fd.set('detalhe', JSON.stringify({ pecas: form.pecas, insercoes: form.insercoes }))

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
      <h1 className="text-xl font-semibold text-gray-900 mb-5">{submitLabel === 'Gravar' ? 'Adicionar' : 'Editar'} Mídia Digital</h1>

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
                <th className="px-1 py-1 w-20">Peça</th><th className="px-1 py-1 w-36">Tipo</th><th className="px-1 py-1">Título</th><th className="px-1 py-1 w-40">Formato</th><th className="w-8" />
              </tr></thead>
              <tbody>
                {form.pecas.map((p, i) => (
                  <tr key={i}>
                    <td className="px-1 py-1"><input value={p.peca} onChange={e => setPeca(i, 'peca', e.target.value)} className={cellCls} /></td>
                    <td className="px-1 py-1"><input value={p.tipo} onChange={e => setPeca(i, 'tipo', e.target.value)} placeholder="Ex.: Vídeo" className={cellCls} /></td>
                    <td className="px-1 py-1"><input value={p.titulo} onChange={e => setPeca(i, 'titulo', e.target.value)} className={cellCls} /></td>
                    <td className="px-1 py-1"><input value={p.formato} onChange={e => setPeca(i, 'formato', e.target.value)} placeholder="Ex.: Reels" className={cellCls} /></td>
                    <td className="px-1 py-1 text-right">{form.pecas.length > 1 && <button aria-label="Remover" type="button" onClick={() => delPeca(i)} className="text-gray-300 hover:text-red-500 transition"><Trash2 className="w-3.5 h-3.5" /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Inserções */}
        <div className={cardCls}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Inserções</h3>
            <button type="button" onClick={addIns} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"><Plus className="w-3.5 h-3.5" /> Adicionar</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead><tr className="text-xs font-medium text-gray-400 text-left">
                <th className="px-1 py-1 w-20">Peça</th><th className="px-1 py-1 w-32">Local</th><th className="px-1 py-1 w-24">Tipo</th>
                <th className="px-1 py-1">Descrição</th><th className="px-1 py-1 w-20 text-right">Qtd.</th>
                <th className="px-1 py-1 w-28 text-right">Valor</th><th className="px-1 py-1 w-20 text-right">Desc.%</th>
                <th className="px-1 py-1 w-28 text-right">Total</th><th className="w-8" />
              </tr></thead>
              <tbody>
                {form.insercoes.map((r, i) => (
                  <tr key={i}>
                    <td className="px-1 py-1"><Select size="sm" value={r.peca} onChange={v => setIns(i, 'peca', v)} options={pecaOptions} /></td>
                    <td className="px-1 py-1"><input value={r.local} onChange={e => setIns(i, 'local', e.target.value)} placeholder="Instagram, G1…" className={cellCls} /></td>
                    <td className="px-1 py-1"><input value={r.tipo} onChange={e => setIns(i, 'tipo', e.target.value)} placeholder="CPC, Período…" className={cellCls} /></td>
                    <td className="px-1 py-1"><input value={r.descricao} onChange={e => setIns(i, 'descricao', e.target.value)} className={cellCls} /></td>
                    <td className="px-1 py-1"><input value={r.quantidade} onChange={e => setIns(i, 'quantidade', e.target.value)} className={cn(cellCls, 'text-right')} /></td>
                    <td className="px-1 py-1"><input inputMode="decimal" value={r.valor} onChange={e => setIns(i, 'valor', e.target.value)} placeholder="0,00" className={cn(cellCls, 'text-right')} /></td>
                    <td className="px-1 py-1"><input inputMode="decimal" value={r.desconto} onChange={e => setIns(i, 'desconto', e.target.value)} className={cn(cellCls, 'text-right')} /></td>
                    <td className="px-1 py-1 text-right font-medium whitespace-nowrap">{formatBRL(rowTotal(r))}</td>
                    <td className="px-1 py-1 text-right">{form.insercoes.length > 1 && <button aria-label="Remover" type="button" onClick={() => delIns(i)} className="text-gray-300 hover:text-red-500 transition"><Trash2 className="w-3.5 h-3.5" /></button>}</td>
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
          <TextoPadraoField label="Observação" value={form.observacao} onChange={v => set('observacao', v)} />
          <div className="mt-4">
            <TextoPadraoField label="Texto Legal" value={form.texto_legal} onChange={v => set('texto_legal', v)} defaultText={defaultTextoLegal} />
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
