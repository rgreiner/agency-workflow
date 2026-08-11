'use client'

/**
 * Botão de submit com trava — `useFormStatus` desabilita enquanto a ação corre.
 *
 * Nasceu de um incidente real de login (07/08/2026): o log de tentativas registrou
 * SEIS falhas no mesmo segundo para a mesma pessoa. Ninguém digita seis vezes em um
 * segundo — o formulário não dava sinal nenhum de que estava enviando, então bastava
 * segurar o Enter para disparar uma rajada. Cada disparo conta no limite de 8 por 15
 * minutos, e o bloqueio que vem depois é lido como "minha senha parou de funcionar".
 */
import { useFormStatus } from 'react-dom'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function SubmitButton({
  children, pendingLabel, className,
}: {
  children: React.ReactNode
  pendingLabel?: string
  className?: string
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={cn(
        'inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed',
        className,
      )}
    >
      {pending && <Loader2 className="w-4 h-4 animate-spin" />}
      {pending ? (pendingLabel ?? 'Enviando…') : children}
    </button>
  )
}
