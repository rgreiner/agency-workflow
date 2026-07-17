import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Landmark, Plug } from 'lucide-react'
import { assertFinanceAccess } from '@/lib/finance'
import { loadConciliacao } from '@/lib/conciliacao'
import { ConciliacaoClient } from '../../conciliacao/ConciliacaoClient'
import { ImportarOfxButton } from './ImportarOfxButton'

// Busca da própria API — o builder não alcança o IP público do VPS.
export const dynamic = 'force-dynamic'

export default async function ContaPage({
  params,
}: {
  params: Promise<{ orgSlug: string; contaId: string }>
}) {
  const { orgSlug, contaId } = await params
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: conta } = await sb
    .from('contas_financeiras')
    .select('id, nome, tipo, cor')
    .eq('id', contaId).eq('org_id', orgId).maybeSingle()
  if (!conta) notFound()

  const data = await loadConciliacao(sb, orgId, contaId)
  const pendentesN = data.pendentes.length

  return (
    <div>
      <div className="p-6 pb-0">
        <Link href={`/${orgSlug}/financeiro/contas`} className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition mb-3">
          <ArrowLeft className="w-4 h-4" /> Contas
        </Link>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center text-[#fff]" style={{ backgroundColor: conta.cor || '#f97316' }}>
              <Landmark className="w-4 h-4" />
            </span>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">{conta.nome}</h1>
              <p className="text-gray-500 text-sm mt-0.5">
                Movimentações e conciliação{pendentesN > 0 ? ` — ${pendentesN} pendente(s)` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled
              title="Em breve: conectar a integração automática do banco"
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl border border-gray-200 text-gray-400 cursor-not-allowed"
            >
              <Plug className="w-4 h-4" /> Integração automática (em breve)
            </button>
            <ImportarOfxButton orgSlug={orgSlug} contaId={contaId} />
          </div>
        </div>
      </div>

      <ConciliacaoClient orgSlug={orgSlug} {...data} />
    </div>
  )
}
