'use client'

import { useRouter } from 'next/navigation'
import { Printer, ArrowLeft } from 'lucide-react'

/** Barra fixa (não impressa) com botões de imprimir/salvar PDF e voltar. */
export function PrintToolbar({ backHref }: { backHref?: string }) {
  const router = useRouter()
  return (
    <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-3 bg-gray-100 border-b border-gray-200 px-4 py-2.5">
      <button onClick={() => (backHref ? router.push(backHref) : router.back())}
        className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition">
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>
      <button onClick={() => window.print()}
        className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-lg hover:bg-orange-700 transition">
        <Printer className="w-4 h-4" /> Imprimir / Salvar PDF
      </button>
    </div>
  )
}
