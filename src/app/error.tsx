'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, RotateCw, Home } from 'lucide-react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Loga no console do navegador (e o stack real fica nos logs do servidor).
    console.error(error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <div className="max-w-md w-full text-center">
        <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-5">
          <AlertTriangle className="w-7 h-7 text-red-500" />
        </div>
        <h1 className="text-xl font-semibold text-gray-900">Algo deu errado</h1>
        <p className="text-gray-500 text-sm mt-2">
          Ocorreu um erro ao carregar esta tela. Você pode tentar novamente.
        </p>
        {error?.message && (
          <p className="mt-4 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-mono break-words text-left max-h-40 overflow-y-auto">
            {error.message}
          </p>
        )}
        {error?.digest && (
          <p className="mt-2 text-[11px] text-gray-400">Código do erro: {error.digest}</p>
        )}
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={reset}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-[#fff] hover:bg-indigo-700 transition"
          >
            <RotateCw className="w-4 h-4" /> Tentar de novo
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition"
          >
            <Home className="w-4 h-4" /> Início
          </Link>
        </div>
      </div>
    </div>
  )
}
