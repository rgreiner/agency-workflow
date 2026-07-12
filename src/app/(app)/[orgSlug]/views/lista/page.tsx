import { loadActivityList } from '@/lib/activity-list'
import { loadViewPrefs } from '@/app/actions/prefs'
import { ListaClient } from './ListaClient'

export default async function ListaPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ ws?: string; view?: string; persons?: string; statuses?: string; date?: string }>
}) {
  const { orgSlug } = await params
  const { ws, view, persons, statuses, date } = await searchParams
  const archivedView = view === 'arquivadas'
  const csv = (s?: string) => (s ?? '').split(',').map(x => x.trim()).filter(Boolean)

  // Lista = visão completa: todos os clientes e todos os status (inclui Concluído).
  const data = await loadActivityList(orgSlug, { ws, archived: archivedView, includeConcluido: true })
  if (!data) return null
  const dbPrefs = await loadViewPrefs(orgSlug, 'views/lista')

  return (
    <ListaClient
      orgSlug={orgSlug}
      activities={data.activities}
      campMap={data.campMap}
      members={data.members}
      initialWorkspace={ws}
      initialPersons={csv(persons)}
      initialStatuses={csv(statuses)}
      initialDate={date}
      dbPrefs={dbPrefs}
      view={archivedView ? 'arquivadas' : 'ativas'}
    />
  )
}
