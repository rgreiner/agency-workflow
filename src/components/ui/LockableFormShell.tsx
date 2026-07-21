'use client'

import { useState } from 'react'
import { Lock, AlertTriangle } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

// Envolve um formulário de documento. Quando o doc já está liberado pro faturamento
// (situacao 'faturar'/'faturado'), a NF e o valor podem já ter sido emitidos — editar
// gera divergência fiscal. Então abre SOMENTE LEITURA, com aviso e um destravamento
// EXPLÍCITO. Usa `inert` pra desabilitar toda a subárvore (mouse + teclado) sem
// precisar mexer campo a campo.
//
// O destravar exige confirmação de propósito (21/07/2026): antes era um clique
// só em "Editar mesmo assim", fácil de dar sem ler. O documento já saiu para o
// veículo e o financeiro já pode ter emitido em cima dele — quem edita assume
// avisar o financeiro, e isso precisa ser uma decisão consciente, não um reflexo.
export function LockableFormShell({
  initialLocked,
  children,
}: {
  initialLocked: boolean
  children: React.ReactNode
}) {
  const [locked, setLocked] = useState(initialLocked)
  const [confirmando, setConfirmando] = useState(false)

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
              onClick={() => setConfirmando(true)}
              className="shrink-0 text-xs font-medium text-amber-800 border border-amber-300 rounded-lg px-2.5 py-1 hover:bg-amber-100 active:scale-[0.97] transition-colors"
            >
              Editar mesmo assim
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmando}
        title="Editar um documento já liberado?"
        description={
          'Este documento já foi liberado para o faturamento. O veículo pode já tê-lo recebido e o financeiro pode ter emitido a NF com estes valores.\n\n' +
          'Ao continuar, você assume avisar o financeiro sobre a alteração — senão a nota e o lançamento ficam divergentes do documento.'
        }
        confirmLabel="Entendi, vou avisar o financeiro"
        onConfirm={() => { setLocked(false); setConfirmando(false) }}
        onCancel={() => setConfirmando(false)}
      />

      {/* Destravado: some a trava, fica a lembrança de que este documento já
          está no faturamento. Só aparece se ele NASCEU travado. */}
      {initialLocked && !locked && (
        <div className="px-6 pt-5">
          <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5 flex items-center gap-2.5 text-sm text-orange-800">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Edição liberada — <strong className="font-medium">avise o financeiro</strong> depois de salvar.</span>
          </div>
        </div>
      )}

      <div inert={locked || undefined} className={locked ? 'opacity-95' : undefined}>
        {children}
      </div>
    </>
  )
}
