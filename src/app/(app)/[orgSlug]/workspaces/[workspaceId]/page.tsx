import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { loadActivityList } from '@/lib/activity-list'
import { ListaClient } from '../../views/lista/ListaClient'
import { WorkspaceEditButton } from './WorkspaceEditButton'
import { UnarchiveButton } from '@/components/ui/UnarchiveButton'
import { ImportSpecsButton } from './campaigns/[campaignId]/ImportSpecsButton'

export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; workspaceId: string }>
  searchParams: Promise<{ view?: string }>
}) {
  const { orgSlug, workspaceId } = await params
  const { view } = await searchParams
  const archivedView = view === 'arquivadas'
  const supabase = await createClient()

  const { data: workspace } = await supabase
    .from('workspaces').select('id, name, color, description, archived').eq('id', workspaceId).single()
  if (!workspace) return null

  const { data: archivedCampaigns } = await supabase
    .from('campaigns').select('id, name').eq('workspace_id', workspaceId).eq('archived', true)
    .order('name', { ascending: true })

  const data = await loadActivityList(orgSlug, { scopeWorkspaceId: workspaceId, archived: archivedView })
  if (!data) return null

  const campaignOptions = Object.entries(data.campMap).map(([id, c]) => ({ id, name: c.name }))

  return (
    <>
      <ListaClient
        orgSlug={orgSlug}
        activities={data.activities}
        campMap={data.campMap}
        members={data.members}
        view={archivedView ? 'arquivadas' : 'ativas'}
        title={workspace.name}
        routeBase={`workspaces/${workspaceId}`}
        breadcrumb={<Link href={`/${orgSlug}/workspaces`} className="hover:text-gray-600 transition">Clientes</Link>}
        titleActions={
          <WorkspaceEditButton
            orgSlug={orgSlug}
            workspaceId={workspaceId}
            name={workspace.name}
            description={workspace.description ?? ''}
            color={workspace.color}
            archived={workspace.archived ?? false}
          />
        }
        secondaryActions={
          <>
            {campaignOptions.length > 0 && (
              <ImportSpecsButton orgSlug={orgSlug} campaigns={campaignOptions} />
            )}
            <Link
              href={`/${orgSlug}/workspaces/${workspaceId}/campaigns/new`}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"
            >
              <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Nova campanha</span>
            </Link>
          </>
        }
      />

      {/* Campanhas arquivadas */}
      {archivedCampaigns && archivedCampaigns.length > 0 && (
        <div className="px-6 pb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Campanhas arquivadas</h2>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {archivedCampaigns.map(camp => (
              <div key={camp.id} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-sm text-gray-600">{camp.name}</span>
                <UnarchiveButton orgSlug={orgSlug} workspaceId={workspaceId} campaignId={camp.id} />
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
