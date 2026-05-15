import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Plus, Calendar, ArrowLeft } from 'lucide-react'
import { formatDate } from '@/lib/utils'

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ orgSlug: string; workspaceId: string }>
}) {
  const { orgSlug, workspaceId } = await params
  const supabase = await createClient()

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('*')
    .eq('id', workspaceId)
    .single()

  if (!workspace) return null

  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('*, activities(count)')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-1">
        <Link
          href={`/${orgSlug}/workspaces`}
          className="text-gray-400 hover:text-gray-600 transition"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900">{workspace.name}</h1>
      </div>
      {workspace.description && (
        <p className="text-gray-500 text-sm ml-7 mb-6">{workspace.description}</p>
      )}

      <div className="flex items-center justify-between mb-6 ml-7">
        <p className="text-sm text-gray-500">
          {campaigns?.length ?? 0} campanha{campaigns?.length !== 1 ? 's' : ''}
        </p>
        <Link
          href={`/${orgSlug}/workspaces/${workspaceId}/campaigns/new`}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition"
        >
          <Plus className="w-4 h-4" />
          Nova campanha
        </Link>
      </div>

      <div className="ml-7 space-y-3">
        {campaigns && campaigns.length > 0 ? (
          campaigns.map((camp) => {
            const actCount = (camp.activities as unknown as { count: number }[])?.[0]?.count ?? 0
            return (
              <Link
                key={camp.id}
                href={`/${orgSlug}/workspaces/${workspaceId}/campaigns/${camp.id}`}
                className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-6 py-4 hover:border-indigo-300 hover:shadow-sm transition group"
              >
                <div>
                  <h3 className="font-medium text-gray-900 group-hover:text-indigo-600 transition">
                    {camp.name}
                  </h3>
                  {camp.description && (
                    <p className="text-sm text-gray-500 mt-0.5">{camp.description}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    {actCount} atividade{actCount !== 1 ? 's' : ''}
                  </p>
                </div>
                {(camp.start_date || camp.end_date) && (
                  <div className="flex items-center gap-1.5 text-sm text-gray-500 shrink-0 ml-4">
                    <Calendar className="w-4 h-4" />
                    {camp.start_date && formatDate(camp.start_date)}
                    {camp.start_date && camp.end_date && ' → '}
                    {camp.end_date && formatDate(camp.end_date)}
                  </div>
                )}
              </Link>
            )
          })
        ) : (
          <div className="text-center py-20 bg-white rounded-xl border border-gray-200">
            <Calendar className="w-8 h-8 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-900 font-medium">Nenhuma campanha ainda</p>
            <p className="text-gray-500 text-sm mt-1">Crie a primeira campanha deste cliente</p>
          </div>
        )}
      </div>
    </div>
  )
}
