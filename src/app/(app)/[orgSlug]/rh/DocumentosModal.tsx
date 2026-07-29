'use client'

import { useState, useRef, useEffect, useTransition, useCallback } from 'react'
import { Paperclip, FileText, Trash2, Plus, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Select } from '@/components/ui/Select'
import { listarDocumentos, adicionarDocumento, excluirDocumento } from '@/app/actions/rh'

export interface Documento { id: string; tipo: string; nome: string | null; competencia: string | null; created_at: string }

const TIPOS_DOC = [
  { value: 'admissao', label: 'Admissão' }, { value: 'aso', label: 'ASO' }, { value: 'rg', label: 'RG/CPF' },
  { value: 'holerite', label: 'Holerite' }, { value: 'rescisao', label: 'Rescisão' }, { value: 'atestado', label: 'Atestado' },
  { value: 'contrato', label: 'Contrato' }, { value: 'ferias', label: 'Férias' }, { value: 'outro', label: 'Outro' },
]
const tipoLabel = (t: string) => TIPOS_DOC.find(x => x.value === t)?.label ?? t

export function DocumentosModal({ orgSlug, colaboradorId, nome, onClose }: {
  orgSlug: string; colaboradorId: string; nome: string; onClose: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [docs, setDocs] = useState<Documento[]>([])
  const [loading, setLoading] = useState(true)
  const [tipo, setTipo] = useState('outro')
  const [competencia, setCompetencia] = useState('')
  const [uploading, setUploading] = useState(false)
  const [pending, startAction] = useTransition()
  const [down, setDown] = useState(false)

  const recarregar = useCallback(async () => {
    const r = await listarDocumentos(orgSlug, colaboradorId)
    if (r?.error) toast.error(r.error)
    else setDocs(r?.documentos ?? [])
    setLoading(false)
  }, [orgSlug, colaboradorId])

  // setDocs roda só após o await (não é render em cascata); o linter é estático.
  useEffect(() => { recarregar() }, [recarregar]) // eslint-disable-line react-hooks/set-state-in-effect

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
      else { toast.success('Documento anexado.'); setCompetencia(''); await recarregar() }
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Falha no upload') }
    finally { setUploading(false) }
  }

  function excluir(id: string) {
    startAction(async () => {
      const r = await excluirDocumento(orgSlug, colaboradorId, id)
      if (r?.error) toast.error(r.error)
      else { toast.success('Documento removido.'); await recarregar() }
    })
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onMouseDown={() => setDown(true)}
      onClick={e => { if (down && e.target === e.currentTarget) onClose(); setDown(false) }}>
      <div className="modal-card w-full max-w-lg bg-white rounded-2xl shadow-xl border border-gray-200" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Paperclip className="w-4 h-4" /> Documentos <span className="font-normal text-gray-400">· {nome}</span>
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 transition"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-6 py-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-36"><Select value={tipo} onChange={setTipo} size="sm" options={TIPOS_DOC} /></div>
            <input type="month" value={competencia ? competencia.slice(0, 7) : ''} onChange={e => setCompetencia(e.target.value ? `${e.target.value}-01` : '')}
              title="Competência (holerite/atestado)" className="px-2 py-1.5 text-sm bg-gray-100 border border-transparent rounded-lg text-gray-700" />
            <input ref={fileRef} type="file" accept=".pdf,image/*" className="hidden"
              onChange={e => { const x = e.target.files?.[0]; if (x) onPick(x); e.target.value = '' }} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition disabled:opacity-50 ml-auto">
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Anexar
            </button>
          </div>

          {loading ? (
            <p className="text-xs text-gray-400 py-6 text-center">Carregando…</p>
          ) : docs.length === 0 ? (
            <p className="text-xs text-gray-400 py-6 text-center">Nenhum documento. Escolha o tipo e anexe (PDF ou imagem).</p>
          ) : (
            <ul className="space-y-1.5 max-h-80 overflow-y-auto">
              {docs.map(d => (
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
      </div>
    </div>
  )
}
