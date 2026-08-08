import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { carregarResultado } from '@/app/actions/rh-avaliacao'
import { ResultadoCorpo } from '../../../rh/avaliacao/[cicloId]/CicloClient'

export const dynamic = 'force-dynamic'

/** O próprio avaliado vendo o resultado dele. Nunca mostra nomes — a RPC já
 *  devolve `por` nulo quando quem lê é o avaliado. */
export default async function MeuResultadoPage({ params }: { params: Promise<{ orgSlug: string; cicloId: string }> }) {
  const { orgSlug, cicloId } = await params
  const user = await getUsuario()
  if (!user) redirect('/login')

  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: colab } = await (supabase as any)
    .from('rh_colaborador').select('id, nome').eq('membro_user_id', user.id).eq('arquivado', false).maybeSingle()
  if (!colab) redirect(`/${orgSlug}/avaliacao`)

  const r = await carregarResultado(cicloId, colab.id)

  return (
    <div className="p-6 max-w-2xl">
      <Link href={`/${orgSlug}/avaliacao`} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4 transition">
        <ArrowLeft className="w-4 h-4" /> Avaliação
      </Link>

      {'error' in r ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">{r.error}</div>
      ) : (
        <>
          <h1 className="text-lg font-semibold text-gray-900">Seu resultado</h1>
          <p className="text-gray-500 text-sm mt-0.5 mb-5">
            {r.r?.ciclo?.nome} · {r.r?.respondentes} pessoas responderam
          </p>
          <div className="rounded-xl bg-sky-50 border border-sky-200 px-4 py-3 mb-5 text-[12.5px] text-sky-900">
            A barra azul é <b>como você se vê</b>; a laranja, como o time vê. A distância entre as duas
            costuma valer mais que a nota em si. Nomes não aparecem aqui — e média de grupo pequeno
            (menos de {r.r?.min_respondentes}) fica escondida de propósito.
          </div>
          <ResultadoCorpo r={r.r} />
        </>
      )}
    </div>
  )
}
