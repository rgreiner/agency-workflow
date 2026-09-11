'use client'

import type { ReactNode } from 'react'
import { Modal } from './Modal'
import { cn } from '@/lib/utils'

/**
 * Folha inferior (celular): o Modal com a casca ancorada no rodapé. Herda o
 * Esc, o clique-fora que rastreia o mousedown, a trava de rolagem, o focus
 * trap e o retorno do foco; muda só a posição e a entrada (.sheet-card).
 */
export function BottomSheet({ open, onClose, label, children, className }: {
  open: boolean
  onClose: () => void
  label?: string
  children: ReactNode
  className?: string
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      label={label}
      size="full"
      backdropClassName="items-end p-0"
      className={cn(
        'sheet-card rounded-t-2xl rounded-b-none border-b-0 max-h-[85dvh] pb-[env(safe-area-inset-bottom,0px)]',
        className,
      )}
    >
      <div className="mx-auto mt-2.5 mb-1 h-1 w-10 rounded-full bg-gray-300" aria-hidden />
      {children}
    </Modal>
  )
}
