'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RefreshCw } from 'lucide-react'
import { regerarLancamentos } from '@/app/actions/financeiro'

export function GerarLancamentosButton({ orgSlug }: { orgSlug: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  return (
    <button
      onClick={() => startTransition(async () => { await regerarLancamentos(orgSlug); router.refresh() })}
      disabled={isPending}
      className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition disabled:opacity-50"
    >
      {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
      Gerar lançamentos
    </button>
  )
}
