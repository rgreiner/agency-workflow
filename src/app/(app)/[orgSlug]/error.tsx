'use client'

import { useEffect } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { isStaleDeployError, tentarRecarregarUmaVez } from '@/lib/stale-deploy'

export default function OrgError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const stale = isStaleDeployError(error)

  useEffect(() => {
    console.error(error)
    // Deploy novo com a aba aberta: recarrega sozinho. Se a trava de tempo barrar,
    // a tela abaixo já é a certa pro caso — mensagem amigável + botão que recarrega.
    if (stale) tentarRecarregarUmaVez()
  }, [error, stale])

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-5">
          <AlertTriangle className="w-7 h-7 text-red-500" />
        </div>
        <h1 className="text-lg font-semibold text-gray-900">
          {stale ? 'Esta aba está desatualizada' : 'Não foi possível carregar esta tela'}
        </h1>
        <p className="text-gray-500 text-sm mt-2">
          {stale
            ? 'O sistema foi atualizado enquanto esta aba estava aberta. Recarregue para continuar — nenhum dado foi perdido.'
            : 'Ocorreu um erro ao processar esta página. Tente novamente.'}
        </p>
        {/* Mensagem técnica não ajuda quem só precisa recarregar. */}
        {!stale && error?.message && (
          <p className="mt-4 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-mono break-words text-left max-h-40 overflow-y-auto">
            {error.message}
          </p>
        )}
        {error?.digest && (
          <p className="mt-2 text-[11px] text-gray-400">Código do erro: {error.digest}</p>
        )}
        <button
          // Em erro de skew, reset() re-executa a mesma ação morta e falha igual —
          // só um reload de verdade busca o bundle novo.
          onClick={() => (stale ? window.location.reload() : reset())}
          className="inline-flex items-center gap-1.5 px-4 py-2 mt-6 text-sm font-medium rounded-lg bg-orange-600 text-[#fff] hover:bg-orange-700 transition"
        >
          <RotateCw className="w-4 h-4" /> Tentar de novo
        </button>
      </div>
    </div>
  )
}
