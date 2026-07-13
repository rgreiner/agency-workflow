'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Receipt, Loader2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

/**
 * Botão "Faturar" da conferência. Se faltar NF/Boleto (missing), pede confirmação
 * com aviso — mas NÃO trava (decisão: só avisar). action gera o(s) lançamento(s).
 */
export function FaturarButton({ action, missing, okToast }: {
  action: () => Promise<{ error?: string } | void>
  missing: string[]
  okToast: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [confirm, setConfirm] = useState(false)

  function run() {
    start(async () => {
      const res = await action()
      if (res?.error) { toast.error(res.error); return }
      toast.success(okToast)
      setConfirm(false)
      router.refresh()
    })
  }

  if (confirm) {
    return (
      <span className="inline-flex items-center gap-2 text-xs">
        {missing.length > 0 && (
          <span className="inline-flex items-center gap-1 text-amber-600" title={`Faltam: ${missing.join(', ')}`}>
            <AlertTriangle className="w-3.5 h-3.5" /> falta {missing.join(' + ')}
          </span>
        )}
        <span className="text-gray-500">Faturar?</span>
        <button onClick={run} disabled={pending} className="font-medium text-orange-600 hover:text-orange-700 inline-flex items-center gap-1 disabled:opacity-50">
          {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Sim'}
        </button>
        <button onClick={() => setConfirm(false)} className="text-gray-400 hover:text-gray-600">Não</button>
      </span>
    )
  }
  return (
    <button onClick={() => setConfirm(true)}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 text-[#fff] text-xs font-medium rounded-lg hover:bg-orange-700 active:scale-[0.97] transition">
      <Receipt className="w-3.5 h-3.5" /> Faturar
    </button>
  )
}
