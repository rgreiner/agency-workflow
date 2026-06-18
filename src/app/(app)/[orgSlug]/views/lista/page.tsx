import { loadActivityList } from '@/lib/activity-list'
import { ListaClient } from './ListaClient'

export default async function ListaPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ ws?: string; view?: string }>
}) {
  const { orgSlug } = await params
  const { ws, view } = await searchParams
  const archivedView = view === 'arquivadas'

  const data = await loadActivityList(orgSlug, { ws, archived: archivedView })
  if (!data) return null

  return (
    <ListaClient
      orgSlug={orgSlug}
      activities={data.activities}
      campMap={data.campMap}
      members={data.members}
      initialWorkspace={ws}
      view={archivedView ? 'arquivadas' : 'ativas'}
    />
  )
}
