import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { loadActivityList } from '@/lib/activity-list'
import { ListaClient } from '../../../../views/lista/ListaClient'
import { CampaignEditButton } from './CampaignEditButton'
import { ImportSpecsButton } from './ImportSpecsButton'

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; workspaceId: string; campaignId: string }>
  searchParams: Promise<{ view?: string }>
}) {
  const { orgSlug, workspaceId, campaignId } = await params
  const { view } = await searchParams
  const archivedView = view === 'arquivadas'
  const supabase = await createClient()

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('*, workspaces(name)')
    .eq('id', campaignId)
    .single()
  if (!campaign) return null

  const data = await loadActivityList(orgSlug, { scopeCampaignId: campaignId, archived: archivedView })
  if (!data) return null

  const wsName = (campaign.workspaces as { name: string })?.name

  return (
    <ListaClient
      orgSlug={orgSlug}
      activities={data.activities}
      campMap={data.campMap}
      members={data.members}
      view={archivedView ? 'arquivadas' : 'ativas'}
      title={campaign.name}
      routeBase={`workspaces/${workspaceId}/campaigns/${campaignId}`}
      newActivityCampaign={{ workspaceId, campaignId }}
      secondaryActions={<ImportSpecsButton orgSlug={orgSlug} campaignId={campaignId} />}
      breadcrumb={
        <span className="flex items-center gap-1.5">
          <Link href={`/${orgSlug}/workspaces`} className="hover:text-gray-600 transition">Clientes</Link>
          <span>/</span>
          <Link href={`/${orgSlug}/workspaces/${workspaceId}`} className="hover:text-gray-600 transition">{wsName}</Link>
        </span>
      }
      titleActions={
        <CampaignEditButton
          orgSlug={orgSlug}
          workspaceId={workspaceId}
          campaignId={campaignId}
          name={campaign.name}
          description={campaign.description ?? ''}
          startDate={campaign.start_date ?? ''}
          endDate={campaign.end_date ?? ''}
          archived={campaign.archived ?? false}
        />
      }
    />
  )
}
