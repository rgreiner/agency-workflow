'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Check, Archive, ArchiveRestore } from 'lucide-react'
import { toast } from 'sonner'
import { Select } from '@/components/ui/Select'
import { formatBRL, parseMoney } from '@/lib/midia'
import { maskCPF, maskPhone } from '@/lib/masks'
import { salvarColaborador, setColaboradorArquivado } from '@/app/actions/rh'

export interface Colaborador {
  id: string; nome: string; cpf: string | null; email: string | null; telefone: string | null
  cargo: string | null; tipo_vinculo: string | null; data_admissao: string | null; data_demissao: string | null
  status: string; gestor_id: string | null; salario_atual: number | string | null; observacao: string | null; arquivado: boolean
  membro_user_id: string | null
}
export interface GestorRef { id: string; nome: string }
export interface MembroRef { user_id: string; profiles: { full_name: string | null; email: string } | null }

const VINCULOS = [{ value: 'clt', label: 'CLT' }, { value: 'pj', label: 'PJ' }, { value: 'estagio', label: 'Estágio' }, { value: 'outro', label: 'Outro' }]
const STATUS = [{ value: 'ativo', label: 'Ativo' }, { value: 'afastado', label: 'Afastado' }, { value: 'desligado', label: 'Desligado' }]
const inputCls = 'w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent'
const labelCls = 'block text-sm font-medium text-gray-700 mb-1.5'

export function ColaboradorClient({ orgSlug, colab, gestores, membros }: {
  orgSlug: string; colab: Colaborador; gestores: GestorRef[]; membros: MembroRef[]
}) {
  const router = useRouter()
  const [f, setF] = useState({
    nome: colab.nome ?? '', cpf: colab.cpf ? maskCPF(colab.cpf) : '', email: colab.email ?? '', telefone: colab.telefone ? maskPhone(colab.telefone) : '',
    cargo: colab.cargo ?? '', tipo_vinculo: colab.tipo_vinculo ?? '', status: colab.status ?? 'ativo',
    data_admissao: colab.data_admissao ?? '', data_demissao: colab.data_demissao ?? '',
    gestor_id: colab.gestor_id ?? '', salario_atual: colab.salario_atual != null ? formatBRL(Number(colab.salario_atual)).replace('R$', '').trim() : '',
    observacao: colab.observacao ?? '', membro_user_id: colab.membro_user_id ?? '',
  })
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }))
  const [saving, startSave] = useTransition()
  const [pending, startAction] = useTransition()

  function salvar() {
    if (!f.nome.trim()) { toast.error('Nome é obrigatório.'); return }
    startSave(async () => {
      const r = await salvarColaborador(orgSlug, colab.id, {
        ...f,
        // Demissão só faz sentido p/ desligado; se voltou a ativo, limpa.
        data_demissao: f.status === 'desligado' ? f.data_demissao : null,
        salario_atual: f.salario_atual ? String(parseMoney(f.salario_atual)) : null,
        gestor_id: f.gestor_id || null,
      })
      if (r?.error) toast.error(r.error)
      else { toast.success('Ficha salva.'); router.push(`/${orgSlug}/rh`) }
    })
  }

  function arquivar(v: boolean) {
    startAction(async () => {
      const r = await setColaboradorArquivado(orgSlug, colab.id, v)
      if (r?.error) toast.error(r.error)
      else { toast.success(v ? 'Colaborador arquivado.' : 'Colaborador restaurado.'); router.refresh() }
    })
  }

  return (
    <div className="p-6 max-w-3xl">
      <button onClick={() => router.push(`/${orgSlug}/rh`)} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition mb-4">
        <ArrowLeft className="w-4 h-4" /> Pessoas
      </button>

      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{f.nome || 'Colaborador'}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{f.cargo || 'Sem cargo'}</p>
        </div>
        <button onClick={() => arquivar(!colab.arquivado)} disabled={pending}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 hover:text-gray-800 rounded-xl hover:bg-gray-100 transition disabled:opacity-50">
          {colab.arquivado ? <><ArchiveRestore className="w-4 h-4" /> Restaurar</> : <><Archive className="w-4 h-4" /> Arquivar</>}
        </button>
      </div>

      {/* Ficha */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div><label className={labelCls}>Nome *</label><input value={f.nome} onChange={e => set('nome', e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Cargo</label><input value={f.cargo} onChange={e => set('cargo', e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>CPF</label><input value={f.cpf} onChange={e => set('cpf', maskCPF(e.target.value))} className={inputCls} placeholder="000.000.000-00" inputMode="numeric" /></div>
          <div><label className={labelCls}>Vínculo</label><Select value={f.tipo_vinculo} onChange={v => set('tipo_vinculo', v)} options={VINCULOS} placeholder="—" /></div>
          <div><label className={labelCls}>E-mail</label><input value={f.email} onChange={e => set('email', e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Telefone</label><input value={f.telefone} onChange={e => set('telefone', maskPhone(e.target.value))} className={inputCls} placeholder="(00) 00000-0000" inputMode="tel" /></div>
          <div><label className={labelCls}>Admissão</label><input type="date" value={f.data_admissao} onChange={e => set('data_admissao', e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Situação</label><Select value={f.status} onChange={v => set('status', v)} options={STATUS} /></div>
          {f.status === 'desligado' && <div><label className={labelCls}>Demissão</label><input type="date" value={f.data_demissao} onChange={e => set('data_demissao', e.target.value)} className={inputCls} /></div>}
          <div><label className={labelCls}>Salário atual</label><input inputMode="decimal" value={f.salario_atual} onChange={e => set('salario_atual', e.target.value)} className={inputCls} placeholder="0,00" /></div>
          <div><label className={labelCls}>Gestor</label><Select value={f.gestor_id} onChange={v => set('gestor_id', v)} options={[{ value: '', label: '— nenhum —' }, ...gestores.map(g => ({ value: g.id, label: g.nome }))]} /></div>
          <div><label className={labelCls}>Vincular ao login <span className="font-normal text-gray-400">(habilita o ponto)</span></label>
            <Select value={f.membro_user_id} onChange={v => set('membro_user_id', v)} options={[{ value: '', label: '— não vinculado —' }, ...membros.map(m => ({ value: m.user_id, label: m.profiles?.full_name || m.profiles?.email || m.user_id }))]} /></div>
          <div className="col-span-2"><label className={labelCls}>Observação</label><textarea value={f.observacao} onChange={e => set('observacao', e.target.value)} rows={2} className={inputCls} /></div>
        </div>
        <div className="flex justify-end">
          <button onClick={salvar} disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar ficha
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-3">Os documentos ficam na lista de Pessoas — botão “Documentos” na linha da pessoa.</p>
    </div>
  )
}
