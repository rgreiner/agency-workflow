'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Receipt, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { setProducaoSituacao } from '@/app/actions/producao'

/**
 * Faturamento → "Gerar lançamentos" de um Fee: marca a produção como 'faturado',
 * o que dispara gerar_lancamentos_producao (1 lançamento por parcela).
 */
export function GerarFeeButton({ orgSlug, feeId, parcelas }: { orgSlug: string; feeId: string; parcelas: number }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [confirm, setConfirm] = useState(false)

  function run() {
    start(async () => {
      const res = await setProducaoSituacao(orgSlug, feeId, 'faturado', 'financeiro/faturamento')
      if (res?.error) { toast.error(res.error); return }
      toast.success(parcelas > 0 ? `${parcelas} parcela(s) lançada(s) no financeiro.` : 'Fee lançado no financeiro.')
      router.refresh()
    })
  }

  if (confirm) {
    return (
      <span className="inline-flex items-center gap-2 text-xs">
        <span className="text-gray-500">Faturar {parcelas > 0 ? `${parcelas}x` : ''}?</span>
        <button onClick={run} disabled={pending} className="font-medium text-orange-600 hover:text-orange-700 inline-flex items-center gap-1 disabled:opacity-50">
          {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Sim'}
        </button>
        <button onClick={() => setConfirm(false)} className="text-gray-400 hover:text-gray-600">Não</button>
      </span>
    )
  }
  return (
    <button
      onClick={() => setConfirm(true)}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 text-[#fff] text-xs font-medium rounded-lg hover:bg-orange-700 transition"
    >
      <Receipt className="w-3.5 h-3.5" /> Faturar
    </button>
  )
}
