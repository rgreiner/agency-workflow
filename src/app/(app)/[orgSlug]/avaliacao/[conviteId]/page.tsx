import { redirect } from 'next/navigation'
import { getUsuario } from '@/lib/auth/server'
import { carregarQuestionario } from '@/app/actions/rh-avaliacao'
import { ResponderClient } from './ResponderClient'

export const dynamic = 'force-dynamic'

export default async function ResponderPage({ params }: { params: Promise<{ orgSlug: string; conviteId: string }> }) {
  const { orgSlug, conviteId } = await params
  const user = await getUsuario()
  if (!user) redirect('/login')

  const r = await carregarQuestionario(conviteId)
  if ('error' in r) {
    return (
      <div className="p-6 max-w-lg">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">{r.error}</div>
      </div>
    )
  }

  return <ResponderClient orgSlug={orgSlug} q={r.q!} />
}
