'use client'

import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Campo de texto que pré-carrega um TEXTO PADRÃO da org (Configurações → Documentos)
 * em modo somente-leitura, com botão "Editar" que libera a edição (salva por
 * documento). Sem texto padrão, degrada para um textarea comum. Reusado nos forms
 * de Mídia e no Fee. A leitura vale quando o valor ainda é exatamente o padrão.
 */
export function TextoPadraoField({ label, value, onChange, defaultText = '', rows = 3, hint }: {
  label: string
  value: string
  onChange: (v: string) => void
  defaultText?: string
  rows?: number
  hint?: string
}) {
  const [editing, setEditing] = useState(() => !defaultText || value !== defaultText)
  const inputCls = 'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent'

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="block text-xs font-medium text-gray-600">{label}</label>
        {!editing && !!defaultText && (
          <button type="button" onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-700 transition-colors">
            <Pencil className="w-3 h-3" /> Editar
          </button>
        )}
      </div>
      {editing ? (
        <textarea rows={rows} value={value} onChange={e => onChange(e.target.value)} className={cn(inputCls, 'resize-none')} />
      ) : (
        <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5 text-sm text-gray-500 whitespace-pre-line">
          {value || <span className="text-gray-400">—</span>}
          <p className="mt-1.5 text-[11px] text-gray-400">{hint ?? 'Texto padrão de Configurações → Documentos. Clique em “Editar” para personalizar só deste documento.'}</p>
        </div>
      )}
    </div>
  )
}
