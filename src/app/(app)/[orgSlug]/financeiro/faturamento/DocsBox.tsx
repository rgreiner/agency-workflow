'use client'

import { useRef, useState } from 'react'
import { Paperclip, Plus, Loader2, FileText, ExternalLink, Trash2, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { uploadFile } from '@/lib/storage/upload-client'
import type { Anexo } from '@/app/actions/financeiro'

export const TIPO_OPTIONS = [
  { value: 'NF', label: 'NF' },
  { value: 'Boleto', label: 'Boleto' },
  { value: 'Outro', label: 'Outro' },
]

/** Faltando pra faturar completo: NF e/ou Boleto (documentos "Outro" são opcionais). */
export function faltando(anexos: Anexo[]): string[] {
  const out: string[] = []
  if (!anexos.some(a => a.tipo === 'NF')) out.push('NF')
  if (!anexos.some(a => a.tipo === 'Boleto')) out.push('Boleto')
  return out
}

function Pill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium',
      ok ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-400')}>
      {ok ? <Check className="w-3 h-3" /> : <span className="w-3 h-3 inline-block rounded-full border border-current opacity-50" />}
      {label}
    </span>
  )
}

/**
 * Recolhimento de documentos na conferência do Faturamento (NF, boleto, comprovantes).
 * Sobe o arquivo pro volume e devolve a nova lista via onChange (o pai persiste no
 * doc de origem). O checklist NF·Boleto·Docs é derivado dos tipos dos anexos.
 */
export function DocsBox({ anexos, onChange }: { anexos: Anexo[]; onChange: (next: Anexo[]) => void }) {
  const [tipo, setTipo] = useState('NF')
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const hasNF = anexos.some(a => a.tipo === 'NF')
  const hasBoleto = anexos.some(a => a.tipo === 'Boleto')
  const nDocs = anexos.filter(a => a.tipo === 'Outro').length

  async function onPick(file: File) {
    setUploading(true); setErr('')
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf'
      const url = await uploadFile('lancamentos', `${crypto.randomUUID()}.${ext}`, file)
      onChange([...anexos, { url, nome: file.name, tipo }])
    } catch (e) { setErr(e instanceof Error ? e.message : 'Falha no upload') }
    finally { setUploading(false) }
  }

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-3">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-1.5">
          <Paperclip className="w-3.5 h-3.5 text-gray-400" />
          <Pill ok={hasNF} label="NF" />
          <Pill ok={hasBoleto} label="Boleto" />
          <Pill ok={nDocs > 0} label={nDocs > 0 ? `Docs (${nDocs})` : 'Docs'} />
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-24"><Select value={tipo} onChange={setTipo} size="sm" options={TIPO_OPTIONS} /></div>
          <input ref={fileRef} type="file" accept=".pdf,image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = '' }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 active:scale-[0.97] transition disabled:opacity-50">
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Anexar
          </button>
        </div>
      </div>
      {err && <p className="text-xs text-red-600 mb-2">{err}</p>}
      {anexos.length === 0 ? (
        <p className="text-xs text-gray-400">Anexe a NF, o boleto e os comprovantes do trabalho antes de faturar.</p>
      ) : (
        <ul className="space-y-1.5">
          {anexos.map((a, i) => (
            <li key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-1.5">
              <FileText className="w-4 h-4 text-orange-600 shrink-0" />
              <span className="text-[10px] font-medium text-gray-500 bg-gray-200 rounded px-1.5 py-0.5 shrink-0">{a.tipo}</span>
              <a href={a.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 text-sm text-gray-700 truncate hover:text-orange-600 inline-flex items-center gap-1">
                <span className="truncate">{a.nome}</span><ExternalLink className="w-3 h-3 opacity-50 shrink-0" />
              </a>
              <button type="button" onClick={() => onChange(anexos.filter((_, j) => j !== i))} aria-label="Remover"
                className="text-gray-400 hover:text-red-500 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
