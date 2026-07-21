'use client'

import { useEffect, useRef } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'

interface Props {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open, title, description,
  confirmLabel = 'Excluir', cancelLabel = 'Cancelar',
  loading = false,
  onConfirm, onCancel,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Esc cancela; foco inicial no botão seguro (Cancelar)
  useEffect(() => {
    if (!open) return
    cancelRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center px-4"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0 bg-gray-900/40 backdrop-blur-[2px] animate-[fadeIn_0.12s_ease-out]"
        onClick={loading ? undefined : onCancel}
      />

      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-gray-200 p-6 animate-[paletteIn_0.15s_ease-out]">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-red-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
            {/* pre-line: descrição com mais de um parágrafo (ex.: destravar um
                documento já faturado) precisa respirar pra ser lida de verdade. */}
            <p className="text-sm text-gray-500 mt-1 leading-relaxed whitespace-pre-line">{description}</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 mt-6">
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-[#fff] bg-red-600 hover:bg-red-700 rounded-lg transition disabled:opacity-60"
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
