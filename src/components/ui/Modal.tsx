'use client'

/**
 * Casca única dos modais do app.
 *
 * O visual já era quase padrão — 28 dos 36 modais usam `.modal-backdrop` e
 * `.modal-card`. O que divergia era o COMPORTAMENTO: só 5 fechavam no Esc, 18
 * tinham clique-fora e exatamente 1 travava a rolagem do fundo. Então o valor
 * aqui não é uniformizar aparência, é que "fechar um modal" passe a significar a
 * mesma coisa em qualquer tela.
 *
 * O que a casca resolve, e cada modal deixa de reimplementar:
 *  • Esc fecha (a menos que `dismissable={false}` — útil enquanto salva).
 *  • Clique-fora fecha, rastreando o MOUSEDOWN: o clique tem que começar E
 *    terminar no backdrop. Sem isso, um popup ancorado no body (a @menção, um
 *    Select) fecha o modal junto quando você solta o mouse fora do card —
 *    bug que já apareceu aqui antes.
 *  • Rolagem do fundo travada enquanto aberto, sem "pulo" da barra de rolagem.
 *  • Foco vai pro card ao abrir e VOLTA pro gatilho ao fechar.
 *  • `role="dialog" aria-modal` e o rótulo acessível.
 *
 * A marcação de dentro é de quem chama: migrar um modal é trocar as duas divs
 * de fora, não reescrever a tela.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Larguras em uso no app (11 valores diferentes viraram estes 6). */
const LARGURAS = {
  xs: 'max-w-xs', sm: 'max-w-sm', md: 'max-w-md',
  lg: 'max-w-lg', xl: 'max-w-2xl', full: 'max-w-5xl',
} as const

export function Modal({
  open, onClose, children, size = 'md', label,
  dismissable = true, dismissOnBackdrop = true, className, backdropClassName,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  size?: keyof typeof LARGURAS
  /** Rótulo acessível. Use o mesmo título que aparece no cabeçalho. */
  label?: string
  /** false enquanto salva: Esc e clique-fora param de fechar. */
  dismissable?: boolean
  /**
   * Formulário longo passa `false`: um clique torto fora do card não pode
   * jogar fora quinze campos preenchidos. Esc continua fechando (é deliberado)
   * e o X/Cancelar também. É a única exceção prevista — e é uma regra, não um
   * comportamento por tela.
   */
  dismissOnBackdrop?: boolean
  className?: string
  backdropClassName?: string
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const abriuNoBackdrop = useRef(false)
  const focoAnterior = useRef<HTMLElement | null>(null)

  // Esc + foco (entra no card, volta pro gatilho ao fechar)
  useEffect(() => {
    if (!open) return
    focoAnterior.current = document.activeElement as HTMLElement | null
    cardRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && dismissable) { e.preventDefault(); onClose() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      focoAnterior.current?.focus?.()
    }
  }, [open, dismissable, onClose])

  // Trava a rolagem do fundo. Compensa a largura da barra pra página não "pular".
  useEffect(() => {
    if (!open) return
    const { body } = document
    const overflowAntes = body.style.overflow
    const padAntes = body.style.paddingRight
    const barra = window.innerWidth - document.documentElement.clientWidth
    body.style.overflow = 'hidden'
    if (barra > 0) body.style.paddingRight = `${barra}px`
    return () => { body.style.overflow = overflowAntes; body.style.paddingRight = padAntes }
  }, [open])

  if (!open) return null

  return (
    <div
      className={cn('modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40', backdropClassName)}
      // O par mousedown/mouseup é o que impede o popup ancorado no body de
      // derrubar o modal: se o clique começou dentro do card, soltar fora não fecha.
      onMouseDown={e => { abriuNoBackdrop.current = e.target === e.currentTarget }}
      onMouseUp={e => {
        if (!dismissable || !dismissOnBackdrop) return
        if (e.target === e.currentTarget && abriuNoBackdrop.current) onClose()
        abriuNoBackdrop.current = false
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cn(
          'modal-card w-full bg-white rounded-2xl shadow-xl border border-gray-200 outline-none',
          'max-h-[calc(100vh-2rem)] overflow-y-auto',
          LARGURAS[size], className,
        )}
      >
        {children}
      </div>
    </div>
  )
}

/** Cabeçalho padrão (título + fechar). Opcional — modal com header próprio ignora. */
export function ModalHeader({ title, onClose, children }: { title: ReactNode; onClose?: () => void; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-100">
      <h2 className="text-base font-semibold text-gray-900 min-w-0 truncate">{title}</h2>
      <div className="flex items-center gap-2 shrink-0">
        {children}
        {onClose && (
          <button type="button" aria-label="Fechar" onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
