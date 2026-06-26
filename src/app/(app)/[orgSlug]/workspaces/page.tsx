import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Plus, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { UnarchiveButton } from '@/components/ui/UnarchiveButton'

export default async function WorkspacesPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ view?: string }>
}) {
  const { orgSlug } = await params
  const { view } = await searchParams
  const archivedView = view === 'arquivados'
  const supabase = await createClient()

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return null

  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('*, campaigns(count)')
    .eq('org_id', org.id)
    .eq('archived', archivedView)
    .order('created_at', { ascending: false })

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Clientes</h1>
          <p className="text-gray-500 text-sm mt-0.5">Espaços de trabalho por cliente</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
            <Link href={`/${orgSlug}/workspaces`}
              className={cn('px-2.5 py-1 rounded-md transition', !archivedView ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700')}>
              Ativos
            </Link>
            <Link href={`/${orgSlug}/workspaces?view=arquivados`}
              className={cn('px-2.5 py-1 rounded-md transition', archivedView ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700')}>
              Arquivados
            </Link>
          </div>
          {!archivedView && (
            <Link
              href={`/${orgSlug}/workspaces/new`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 transition"
            >
              <Plus className="w-4 h-4" />
              Novo cliente
            </Link>
          )}
        </div>
      </div>

      {workspaces && workspaces.length > 0 ? (
        <div className="grid grid-cols-3 gap-4">
          {workspaces.map((ws) => {
            const campaignCount = (ws.campaigns as unknown as { count: number }[])?.[0]?.count ?? 0
            return (
              <Link
                key={ws.id}
                href={`/${orgSlug}/workspaces/${ws.id}`}
                className="bg-white rounded-xl border border-gray-200 p-6 hover:border-orange-300 hover:shadow-sm transition group"
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: ws.color + '20' }}
                  >
                    <FolderOpen className="w-5 h-5" style={{ color: ws.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-gray-900 group-hover:text-orange-600 transition truncate">
                      {ws.name}
                    </h3>
                    {ws.description && (
                      <p className="text-sm text-gray-500 mt-0.5 truncate">{ws.description}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-2">
                      {campaignCount} campanha{campaignCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                {archivedView && (
                  <div className="mt-4 flex justify-end">
                    <UnarchiveButton orgSlug={orgSlug} workspaceId={ws.id} />
                  </div>
                )}
              </Link>
            )
          })}
        </div>
      ) : (
        <div className="text-center py-24 bg-white rounded-xl border border-gray-200">
          <FolderOpen className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-gray-900 font-medium">
            {archivedView ? 'Nenhum cliente arquivado' : 'Nenhum cliente ainda'}
          </h3>
          <p className="text-gray-500 text-sm mt-1">
            {archivedView ? 'Clientes arquivados aparecem aqui.' : 'Crie o primeiro espaço de trabalho'}
          </p>
          {!archivedView && (
            <Link
              href={`/${orgSlug}/workspaces/new`}
              className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 transition"
            >
              <Plus className="w-4 h-4" />
              Novo cliente
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
