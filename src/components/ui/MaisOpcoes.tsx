'use client'

import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Campos opcionais recolhidos, para o caminho principal do formulário ficar curto.
 *
 * A regra que não pode quebrar: **isto esconde campo vazio, nunca dado**. Se
 * algum dos campos recolhidos já tem conteúdo, a seção nasce aberta — um valor
 * preenchido atrás de um clique que a pessoa não sabe que existe é pior do que o
 * campo visível, porque ela edita o documento inteiro sem ver o que está lá.
 *
 * `preenchidos` é a contagem de campos com valor; quem chama sabe quais são.
 */
export function MaisOpcoes({ children, preenchidos = 0, rotulo = 'Mais opções' }: {
  children: ReactNode
  preenchidos?: number
  rotulo?: string
}) {
  const [aberto, setAberto] = useState(preenchidos > 0)

  return (
    <div>
      <button
        type="button"
        onClick={() => setAberto(a => !a)}
        aria-expanded={aberto}
        className="inline-flex items-center gap-1.5 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 active:scale-[0.98] transition-colors"
      >
        <ChevronRight className={cn('w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ease-out', aberto && 'rotate-90')} />
        {rotulo}
        {!aberto && preenchidos > 0 && (
          <span className="px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 text-[10px] font-semibold tabular-nums">
            {preenchidos}
          </span>
        )}
      </button>
      {aberto && <div className="mt-3">{children}</div>}
    </div>
  )
}
