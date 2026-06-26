'use client'

import { useRef, useState } from 'react'
import { FileText, Loader2, ExternalLink, X } from 'lucide-react'
import { uploadFile } from '@/lib/storage/upload-client'

/**
 * Campo de upload de PDF (ex.: mídia kit do veículo). Sobe pro volume via
 * /api/upload e guarda a URL pública + o nome original. value = URL.
 */
export function PdfField({ value, name, bucket = 'midia-kits', onChange }: {
  value?: string
  name?: string
  bucket?: string
  onChange: (url: string, name: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function handleFile(file: File) {
    if (file.type !== 'application/pdf') { alert('Envie um arquivo PDF.'); return }
    setUploading(true)
    try {
      const url = await uploadFile(bucket, `${crypto.randomUUID()}.pdf`, file)
      onChange(url, file.name)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Falha no upload')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
      />
      {value ? (
        <div className="flex items-center gap-2 bg-gray-100 rounded-xl px-3 py-2">
          <FileText className="w-4 h-4 text-orange-600 shrink-0" />
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 min-w-0 text-sm text-gray-700 truncate hover:text-orange-600 inline-flex items-center gap-1"
          >
            <span className="truncate">{name || 'Mídia kit.pdf'}</span>
            <ExternalLink className="w-3 h-3 opacity-50 shrink-0" />
          </a>
          <button type="button" onClick={() => inputRef.current?.click()} className="text-[11px] text-gray-500 hover:text-gray-700 shrink-0">Trocar</button>
          <button type="button" onClick={() => onChange('', '')} aria-label="Remover" className="text-gray-400 hover:text-red-500 shrink-0"><X className="w-3.5 h-3.5" /></button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full flex items-center justify-center gap-2 bg-gray-100 border border-dashed border-gray-300 rounded-xl px-3 py-2.5 text-sm text-gray-500 hover:bg-gray-200/60 transition disabled:opacity-50"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
          {uploading ? 'Enviando…' : 'Enviar PDF do mídia kit'}
        </button>
      )}
    </div>
  )
}
