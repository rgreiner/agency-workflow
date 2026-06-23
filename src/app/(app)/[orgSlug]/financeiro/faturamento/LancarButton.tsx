'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check } from 'lucide-react'
import { lancarMidia } from '@/app/actions/financeiro'

export function LancarButton({ orgSlug, midiaId }: { orgSlug: string; midiaId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  return (
    <button
      onClick={() => startTransition(async () => { await lancarMidia(orgSlug, midiaId); router.refresh() })}
      disabled={isPending}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-[#fff] text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition"
    >
      {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
      Lançar
    </button>
  )
}
