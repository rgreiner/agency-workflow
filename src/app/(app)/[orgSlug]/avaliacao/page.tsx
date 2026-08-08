import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { minhasPendencias } from '@/app/actions/rh-avaliacao'
import { ClipboardCheck, ChevronRight, Check, Lock, Eye, BarChart3 } from 'lucide-react'

export const dynamic = 'force-dynamic'

const REL: Record<string, string> = {
  auto: 'Sua autoavaliação', gestor: 'Seu liderado', liderado: 'Seu gestor', par: 'Colega',
}

export default async function MinhasAvaliacoesPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const user = await getUsuario()
  if (!user) redirect('/login')

  const pend = await minhasPendencias()
  const abertas = pend.filter(p => !p.respondido)
  const feitas = pend.filter(p => p.respondido)

  // Ciclo encerrado em que a pessoa foi avaliada → pode ver o próprio resultado.
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: colab } = await (supabase as any)
    .from('rh_colaborador').select('id').eq('membro_user_id', user.id).eq('arquivado', false).maybeSingle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: meus } = colab ? await (supabase as any)
    .from('rh_aval_convite')
    .select('ciclo_id, rh_aval_ciclo!ciclo_id(id, nome, status, encerrado_em)')
    .eq('avaliado_id', colab.id).limit(50) : { data: [] }

  const ciclosEncerrados = [...new Map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((meus ?? []) as any[])
      .map(m => m.rh_aval_ciclo)
      .filter(c => c?.status === 'encerrado')
      .map(c => [c.id, c]),
  ).values()]

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-1">
        <ClipboardCheck className="w-5 h-5 text-orange-600" /> Avaliação
      </h1>
      <p className="text-gray-500 text-sm mb-6">
        Feedback para desenvolvimento — não entra em conta de salário nem de bônus.
      </p>

      {abertas.length === 0 && feitas.length === 0 && ciclosEncerrados.length === 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-gray-500">Nada para responder agora.</p>
          <p className="text-xs text-gray-400 mt-1">Quando o RH abrir um ciclo, ele aparece aqui.</p>
        </div>
      )}

      {abertas.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">
            Para responder <span className="text-gray-400">{abertas.length}</span>
          </h2>
          <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-50">
            {abertas.map(p => (
              <Link key={p.convite_id} href={`/${orgSlug}/avaliacao/${p.convite_id}`}
                className="flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50/70 transition">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900">
                    {p.relacao === 'auto' ? 'Sua autoavaliação' : p.avaliado}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-2">
                    <span>{REL[p.relacao] ?? p.relacao}</span>
                    <span className="text-gray-300">·</span>
                    <span>{p.ciclo}</span>
                    {/* Quem vai ler é dito ANTES de responder — sem isso a pessoa
                        responde achando que é anônimo quando não é. */}
                    <span className="text-gray-300">·</span>
                    {p.identificado
                      ? <span className="inline-flex items-center gap-1 text-amber-700"><Eye className="w-3 h-3" /> seu nome aparece</span>
                      : <span className="inline-flex items-center gap-1 text-emerald-700"><Lock className="w-3 h-3" /> anônimo</span>}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {feitas.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Já respondidas</h2>
          <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-50">
            {feitas.map(p => (
              <div key={p.convite_id} className="flex items-center gap-3 px-4 py-2.5">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="flex-1 text-sm text-gray-600">
                  {p.relacao === 'auto' ? 'Sua autoavaliação' : p.avaliado}
                </span>
                <span className="text-xs text-gray-400">{p.ciclo}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {ciclosEncerrados.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Seu resultado</h2>
          <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-50">
            {ciclosEncerrados.map(c => (
              <Link key={c.id} href={`/${orgSlug}/avaliacao/resultado/${c.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50/70 transition">
                <BarChart3 className="w-4 h-4 text-orange-600 shrink-0" />
                <span className="flex-1 text-sm text-gray-800">{c.nome}</span>
                <ChevronRight className="w-4 h-4 text-gray-300" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
