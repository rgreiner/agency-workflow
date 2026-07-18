import Link from 'next/link'
import { Landmark, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'

/**
 * Aviso na home: conciliações bancárias pendentes. Só aparece pra quem tem acesso
 * a Financeiro — a RLS de btg_movements já filtra (quem não é can_finance/owner/admin
 * conta 0), e reforçamos com a checagem de acesso. Some quando não há pendências.
 */
export async function ConciliacaoAlert({ orgSlug, orgId, userId }: {
  orgSlug: string; orgId: string; userId: string
}) {
  const supabase = await createClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: m } = await (supabase as any)
    .from('organization_members').select('role, can_finance')
    .eq('org_id', orgId).eq('user_id', userId).single()
  const isFinance = !!m && (m.can_finance || ['owner', 'admin'].includes(m.role))
  if (!isFinance) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await (supabase as any)
    .from('btg_movements').select('id', { count: 'exact', head: true })
    .eq('org_id', orgId).eq('status', 'pendente')

  const n = count ?? 0
  if (n <= 0) return null

  return (
    <Link href={`/${orgSlug}/financeiro/contas`}
      className="group flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mt-5 mb-5 hover:bg-amber-100/70 transition">
      <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
        <Landmark className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-amber-900">
          {n} movimento{n === 1 ? '' : 's'} bancário{n === 1 ? '' : 's'} a conciliar
        </p>
        <p className="text-xs text-amber-700/80">Abra a conta e case o extrato com os lançamentos.</p>
      </div>
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-800 shrink-0">
        Conciliar <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
      </span>
    </Link>
  )
}
