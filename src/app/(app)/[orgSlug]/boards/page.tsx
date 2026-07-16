import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Plus, Layout, Clock } from 'lucide-react'

export default async function BoardsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const supabase = await createClient()

  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', orgSlug)
    .single()

  if (!org) return null

  const { data: boards } = await supabase
    .from('visual_boards')
    .select('id, title, kind, created_at, updated_at, created_by, profiles!created_by(full_name, avatar_url)')
    .eq('org_id', org.id)
    .order('updated_at', { ascending: false })

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Quadros visuais</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Canvas para organizar ideias, briefings e referências
          </p>
        </div>
        <Link
          href={`/${orgSlug}/boards/new`}
          className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 transition"
        >
          <Plus className="w-4 h-4" />
          Novo quadro
        </Link>
      </div>

      {(!boards || boards.length === 0) ? (
        <div className="flex flex-col items-center justify-center py-24 bg-white rounded-2xl border border-gray-200">
          <div className="w-16 h-16 bg-orange-50 rounded-2xl flex items-center justify-center mb-4">
            <Layout className="w-8 h-8 text-orange-400" />
          </div>
          <p className="text-gray-900 font-medium">Nenhum quadro ainda</p>
          <p className="text-gray-500 text-sm mt-1 mb-6">
            Crie um canvas para organizar imagens, notas e textos visualmente
          </p>
          <Link
            href={`/${orgSlug}/boards/new`}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 transition"
          >
            <Plus className="w-4 h-4" />
            Criar primeiro quadro
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {/* New board card */}
          <Link
            href={`/${orgSlug}/boards/new`}
            className="group flex flex-col items-center justify-center h-40 rounded-2xl border-2 border-dashed border-gray-200 hover:border-orange-300 hover:bg-orange-50/50 transition"
          >
            <div className="w-10 h-10 rounded-xl bg-gray-100 group-hover:bg-orange-100 flex items-center justify-center mb-2 transition">
              <Plus className="w-5 h-5 text-gray-400 group-hover:text-orange-500 transition" />
            </div>
            <span className="text-sm font-medium text-gray-400 group-hover:text-orange-600 transition">
              Novo quadro
            </span>
          </Link>

          {boards.map(board => {
            const creator = board.profiles as { full_name: string | null; avatar_url: string | null } | null
            const isMapa = (board as { kind?: string }).kind === 'mapa'
            const updatedAt = new Date(board.updated_at).toLocaleDateString('pt-BR', {
              day: '2-digit', month: 'short',
            })

            return (
              <Link
                key={board.id}
                href={`/${orgSlug}/boards/${board.id}`}
                className="group flex flex-col h-40 rounded-2xl border border-gray-200 bg-white hover:border-orange-200 hover:shadow-md transition overflow-hidden"
              >
                {/* Preview: o mapa mostra ramos; o quadro livre, post-its */}
                <div className="flex-1 bg-gradient-to-br from-slate-50 to-orange-50/30 relative overflow-hidden">
                  {isMapa ? (
                    <svg viewBox="0 0 160 80" className="w-full h-full opacity-70" aria-hidden="true">
                      <path d="M46 40 C 62 40, 62 20, 78 20" fill="none" stroke="#f97316" strokeWidth="1.5" />
                      <path d="M46 40 C 62 40, 62 40, 78 40" fill="none" stroke="#0ea5e9" strokeWidth="1.5" />
                      <path d="M46 40 C 62 40, 62 60, 78 60" fill="none" stroke="#10b981" strokeWidth="1.5" />
                      <rect x="12" y="31" width="34" height="18" rx="5" fill="#f97316" />
                      <rect x="78" y="12" width="42" height="16" rx="4" fill="#fff" stroke="#f97316" strokeWidth="1.5" />
                      <rect x="78" y="32" width="52" height="16" rx="4" fill="#fff" stroke="#0ea5e9" strokeWidth="1.5" />
                      <rect x="78" y="52" width="36" height="16" rx="4" fill="#fff" stroke="#10b981" strokeWidth="1.5" />
                    </svg>
                  ) : (
                    <>
                      <div className="absolute top-3 left-3 w-16 h-10 bg-yellow-100 rounded-lg shadow-sm opacity-70" />
                      <div className="absolute top-4 left-24 w-20 h-8 bg-blue-100 rounded-lg shadow-sm opacity-70" />
                      <div className="absolute top-12 left-5 w-12 h-8 bg-pink-100 rounded-lg shadow-sm opacity-70" />
                    </>
                  )}
                  <div className="absolute bottom-0 right-0 left-0 h-6 bg-gradient-to-t from-white to-transparent" />
                </div>

                {/* Footer */}
                <div className="px-3.5 py-3 border-t border-gray-100">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold text-gray-900 truncate group-hover:text-orange-600 transition">
                      {board.title}
                    </p>
                    {isMapa && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-700 shrink-0">mapa</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Clock className="w-3 h-3 text-gray-400" />
                    <span className="text-xs text-gray-400">{updatedAt}</span>
                    {creator?.full_name && (
                      <>
                        <span className="text-gray-300">·</span>
                        <span className="text-xs text-gray-400 truncate">{creator.full_name.split(' ')[0]}</span>
                      </>
                    )}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
