'use client'

import { useState } from 'react'
import { Lock } from 'lucide-react'

// Envolve um formulário de documento. Quando o doc já está liberado pro faturamento
// (situacao 'faturar'/'faturado'), a NF e o valor podem já ter sido emitidos — editar
// gera divergência fiscal. Então abre SOMENTE LEITURA, com aviso e um botão explícito
// "Editar mesmo assim". Usa `inert` pra desabilitar toda a subárvore (mouse + teclado)
// sem precisar mexer campo a campo.
export function LockableFormShell({
  initialLocked,
  children,
}: {
  initialLocked: boolean
  children: React.ReactNode
}) {
  const [locked, setLocked] = useState(initialLocked)

  return (
    <>
      {locked && (
        <div className="px-6 pt-5">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
            <Lock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1 text-sm">
              <p className="font-medium text-amber-800">Documento liberado para faturamento — somente leitura.</p>
              <p className="text-amber-700 text-xs mt-0.5">A NF e o valor já podem ter sido emitidos. Editar agora pode gerar divergência fiscal.</p>
            </div>
            <button
              type="button"
              onClick={() => setLocked(false)}
              className="shrink-0 text-xs font-medium text-amber-800 border border-amber-300 rounded-lg px-2.5 py-1 hover:bg-amber-100 active:scale-[0.97] transition-colors"
            >
              Editar mesmo assim
            </button>
          </div>
        </div>
      )}
      <div inert={locked || undefined} className={locked ? 'opacity-95' : undefined}>
        {children}
      </div>
    </>
  )
}
