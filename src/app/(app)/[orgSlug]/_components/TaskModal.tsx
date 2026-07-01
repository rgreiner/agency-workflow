'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'

/**
 * Casco da modal do detalhe da tarefa (intercepting route). Overlay com a tela
 * de detalhe dentro; fecha com Esc, clique no fundo ou no X — sempre via
 * router.back(), pra voltar exatamente pra onde a pessoa estava.
 *
 * Fechar só quando o clique COMEÇA e TERMINA no próprio backdrop. Isso evita
 * fechar quando um popup ancorado no <body> (ex.: o @menção do comentário) é
 * removido no mousedown e o clique "atravessa" pro fundo — e também quando se
 * arrasta uma seleção de texto e solta fora do card.
 */
export function TaskModal({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const downOnBackdrop = useRef(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') router.back() }
    document.addEventListener('keydown', onKey)
    // trava o scroll do fundo enquanto a modal está aberta
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [router])

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 sm:items-center sm:p-4"
      onMouseDown={e => { downOnBackdrop.current = e.target === e.currentTarget }}
      onClick={e => { if (downOnBackdrop.current && e.target === e.currentTarget) router.back() }}
    >
      <div
        className="modal-card relative w-full bg-white shadow-xl flex flex-col overflow-hidden sm:max-w-5xl sm:max-h-[92vh] sm:rounded-2xl"
        onMouseDown={e => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => router.back()}
          title="Fechar"
          aria-label="Fechar"
          className="absolute top-3 right-3 z-10 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors bg-white/80 backdrop-blur"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  )
}
