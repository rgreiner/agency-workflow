'use client'

import { useEffect, useRef } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Modal } from './Modal'

interface Props {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
  /** Campo extra dentro do diálogo (ex.: escolher o destino antes de excluir). */
  children?: React.ReactNode
}

/**
 * Diálogo de confirmação. Construído SOBRE o Modal: ganha de graça a trava de
 * rolagem do fundo, o retorno do foco ao gatilho, o Esc, o clique-fora que
 * rastreia o mousedown e a mesma animação — antes era uma terceira receita de
 * diálogo, sem nada disso. Fica em --z-confirm, acima de um Modal comum; os
 * popovers (Select, Combobox) ficam acima dele em --z-popover, senão o Select
 * de "mover as tarefas para" dentro deste diálogo cai embaixo do backdrop.
 */
export function ConfirmDialog({
  open, title, description,
  confirmLabel = 'Excluir', cancelLabel = 'Cancelar',
  loading = false,
  onConfirm, onCancel, children,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Foco inicial no botão seguro (Cancelar). Roda depois do efeito do Modal
  // (filho), que foca o card — então este vence.
  useEffect(() => {
    if (open) cancelRef.current?.focus()
  }, [open])

  return (
    <Modal
      open={open}
      onClose={onCancel}
      size="sm"
      label={title}
      dismissable={!loading}
      className="p-6"
      backdropClassName="z-[var(--z-confirm)] bg-gray-900/40 backdrop-blur-[2px]"
    >
      <div className="flex items-start gap-3.5">
        <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
          <AlertTriangle className="w-5 h-5 text-red-500" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          {/* pre-line: descrição com mais de um parágrafo (ex.: destravar um
              documento já faturado) precisa respirar pra ser lida de verdade. */}
          <p className="text-sm text-gray-500 mt-1 leading-relaxed whitespace-pre-line">{description}</p>
          {children}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 mt-6">
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-[#fff] bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-60"
        >
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
