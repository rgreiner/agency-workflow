import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Plus, FolderOpen } from 'lucide-react'

export default async function WorkspacesPage({
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

  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('*, campaigns(count)')
    .eq('org_id', org.id)
    .neq('archived', true)
    .order('created_at', { ascending: false })

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Clientes</h1>
          <p className="text-gray-500 text-sm mt-0.5">Espaços de trabalho por cliente</p>
        </div>
        <Link
          href={`/${orgSlug}/workspaces/new`}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition"
        >
          <Plus className="w-4 h-4" />
          Novo cliente
        </Link>
      </div>

      {workspaces && workspaces.length > 0 ? (
        <div className="grid grid-cols-3 gap-4">
          {workspaces.map((ws) => {
            const campaignCount = (ws.campaigns as unknown as { count: number }[])?.[0]?.count ?? 0
            return (
              <Link
                key={ws.id}
                href={`/${orgSlug}/workspaces/${ws.id}`}
                className="bg-white rounded-xl border border-gray-200 p-6 hover:border-indigo-300 hover:shadow-sm transition group"
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: ws.color + '20' }}
                  >
                    <FolderOpen className="w-5 h-5" style={{ color: ws.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-gray-900 group-hover:text-indigo-600 transition truncate">
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
              </Link>
            )
          })}
        </div>
      ) : (
        <div className="text-center py-24 bg-white rounded-xl border border-gray-200">
          <FolderOpen className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-gray-900 font-medium">Nenhum cliente ainda</h3>
          <p className="text-gray-500 text-sm mt-1">Crie o primeiro espaço de trabalho</p>
          <Link
            href={`/${orgSlug}/workspaces/new`}
            className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition"
          >
            <Plus className="w-4 h-4" />
            Novo cliente
          </Link>
        </div>
      )}
    </div>
  )
}
