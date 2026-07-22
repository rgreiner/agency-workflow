'use client'

import { useState, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Check, Paperclip, FileText, Trash2, Archive, ArchiveRestore, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Select } from '@/components/ui/Select'
import { formatBRL, parseMoney } from '@/lib/midia'
import { salvarColaborador, setColaboradorArquivado, adicionarDocumento, excluirDocumento } from '@/app/actions/rh'

export interface Colaborador {
  id: string; nome: string; cpf: string | null; email: string | null; telefone: string | null
  cargo: string | null; tipo_vinculo: string | null; data_admissao: string | null; data_demissao: string | null
  status: string; gestor_id: string | null; salario_atual: number | string | null; observacao: string | null; arquivado: boolean
}
export interface Documento { id: string; tipo: string; nome: string | null; competencia: string | null; created_at: string }
export interface GestorRef { id: string; nome: string }

const VINCULOS = [{ value: 'clt', label: 'CLT' }, { value: 'pj', label: 'PJ' }, { value: 'estagio', label: 'Estágio' }, { value: 'outro', label: 'Outro' }]
const STATUS = [{ value: 'ativo', label: 'Ativo' }, { value: 'afastado', label: 'Afastado' }, { value: 'desligado', label: 'Desligado' }]
const TIPOS_DOC = [
  { value: 'admissao', label: 'Admissão' }, { value: 'aso', label: 'ASO' }, { value: 'rg', label: 'RG/CPF' },
  { value: 'holerite', label: 'Holerite' }, { value: 'rescisao', label: 'Rescisão' }, { value: 'atestado', label: 'Atestado' },
  { value: 'contrato', label: 'Contrato' }, { value: 'ferias', label: 'Férias' }, { value: 'outro', label: 'Outro' },
]
const inputCls = 'w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent'
const labelCls = 'block text-sm font-medium text-gray-700 mb-1.5'

export function ColaboradorClient({ orgSlug, colab, documentos, gestores }: {
  orgSlug: string; colab: Colaborador; documentos: Documento[]; gestores: GestorRef[]
}) {
  const router = useRouter()
  const [f, setF] = useState({
    nome: colab.nome ?? '', cpf: colab.cpf ?? '', email: colab.email ?? '', telefone: colab.telefone ?? '',
    cargo: colab.cargo ?? '', tipo_vinculo: colab.tipo_vinculo ?? '', status: colab.status ?? 'ativo',
    data_admissao: colab.data_admissao ?? '', data_demissao: colab.data_demissao ?? '',
    gestor_id: colab.gestor_id ?? '', salario_atual: colab.salario_atual != null ? formatBRL(Number(colab.salario_atual)).replace('R$', '').trim() : '',
    observacao: colab.observacao ?? '',
  })
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }))
  const [saving, startSave] = useTransition()
  const [pending, startAction] = useTransition()

  function salvar() {
    if (!f.nome.trim()) { toast.error('Nome é obrigatório.'); return }
    startSave(async () => {
      const r = await salvarColaborador(orgSlug, colab.id, {
        ...f,
        salario_atual: f.salario_atual ? String(parseMoney(f.salario_atual)) : null,
        gestor_id: f.gestor_id || null,
      })
      if (r?.error) toast.error(r.error)
      else { toast.success('Ficha salva.'); router.refresh() }
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
          <div><label className={labelCls}>CPF</label><input value={f.cpf} onChange={e => set('cpf', e.target.value)} className={inputCls} placeholder="000.000.000-00" /></div>
          <div><label className={labelCls}>Vínculo</label><Select value={f.tipo_vinculo} onChange={v => set('tipo_vinculo', v)} options={VINCULOS} placeholder="—" /></div>
          <div><label className={labelCls}>E-mail</label><input value={f.email} onChange={e => set('email', e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Telefone</label><input value={f.telefone} onChange={e => set('telefone', e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Admissão</label><input type="date" value={f.data_admissao} onChange={e => set('data_admissao', e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Demissão</label><input type="date" value={f.data_demissao} onChange={e => set('data_demissao', e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Situação</label><Select value={f.status} onChange={v => set('status', v)} options={STATUS} /></div>
          <div><label className={labelCls}>Salário atual</label><input inputMode="decimal" value={f.salario_atual} onChange={e => set('salario_atual', e.target.value)} className={inputCls} placeholder="0,00" /></div>
          <div className="col-span-2"><label className={labelCls}>Gestor</label><Select value={f.gestor_id} onChange={v => set('gestor_id', v)} options={[{ value: '', label: '— nenhum —' }, ...gestores.map(g => ({ value: g.id, label: g.nome }))]} /></div>
          <div className="col-span-2"><label className={labelCls}>Observação</label><textarea value={f.observacao} onChange={e => set('observacao', e.target.value)} rows={2} className={inputCls} /></div>
        </div>
        <div className="flex justify-end">
          <button onClick={salvar} disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar ficha
          </button>
        </div>
      </div>

      <Documentos orgSlug={orgSlug} colaboradorId={colab.id} documentos={documentos} />
    </div>
  )
}

function Documentos({ orgSlug, colaboradorId, documentos }: { orgSlug: string; colaboradorId: string; documentos: Documento[] }) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [tipo, setTipo] = useState('outro')
  const [competencia, setCompetencia] = useState('')
  const [uploading, setUploading] = useState(false)
  const [pending, startAction] = useTransition()

  async function onPick(file: File) {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('colaboradorId', colaboradorId)
      fd.append('file', file)
      const res = await fetch('/api/rh/upload', { method: 'POST', body: fd })
      const j = await res.json()
      if (!res.ok) { toast.error(j.error || 'Falha no upload'); return }
      const r = await adicionarDocumento(orgSlug, colaboradorId, { tipo, nome: j.nome, chave: j.chave, competencia: competencia || null })
      if (r?.error) toast.error(r.error)
      else { toast.success('Documento anexado.'); setCompetencia(''); router.refresh() }
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Falha no upload') }
    finally { setUploading(false) }
  }

  function excluir(id: string) {
    startAction(async () => {
      const r = await excluirDocumento(orgSlug, colaboradorId, id)
      if (r?.error) toast.error(r.error)
      else { toast.success('Documento removido.'); router.refresh() }
    })
  }

  const tipoLabel = (t: string) => TIPOS_DOC.find(x => x.value === t)?.label ?? t

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 mt-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2"><Paperclip className="w-4 h-4" /> Documentos <span className="font-normal text-gray-400">(privados)</span></h2>
        <div className="flex items-center gap-2">
          <div className="w-36"><Select value={tipo} onChange={setTipo} size="sm" options={TIPOS_DOC} /></div>
          <input type="month" value={competencia ? competencia.slice(0, 7) : ''} onChange={e => setCompetencia(e.target.value ? `${e.target.value}-01` : '')}
            title="Competência (holerite/atestado)" className="px-2 py-1.5 text-sm bg-gray-100 border border-transparent rounded-lg text-gray-700" />
          <input ref={fileRef} type="file" accept=".pdf,image/*" className="hidden"
            onChange={e => { const x = e.target.files?.[0]; if (x) onPick(x); e.target.value = '' }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition disabled:opacity-50">
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Anexar
          </button>
        </div>
      </div>

      {documentos.length === 0 ? (
        <p className="text-xs text-gray-400 py-2">Nenhum documento. Escolha o tipo e anexe (PDF ou imagem).</p>
      ) : (
        <ul className="space-y-1.5">
          {documentos.map(d => (
            <li key={d.id} className="flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2">
              <FileText className="w-4 h-4 text-orange-600 shrink-0" />
              <span className="text-[10px] font-medium text-gray-500 bg-gray-200 rounded px-1.5 py-0.5 shrink-0">{tipoLabel(d.tipo)}</span>
              <a href={`/api/rh/documento/${d.id}`} target="_blank" rel="noopener noreferrer"
                className="text-sm text-gray-700 hover:text-orange-600 transition truncate flex-1">{d.nome || 'documento'}</a>
              {d.competencia && <span className="text-xs text-gray-400 tabular-nums shrink-0">{d.competencia.slice(0, 7).split('-').reverse().join('/')}</span>}
              <button onClick={() => excluir(d.id)} disabled={pending} title="Remover"
                className="p-1 text-gray-400 hover:text-red-500 transition disabled:opacity-50 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
