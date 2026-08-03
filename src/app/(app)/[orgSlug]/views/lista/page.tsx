import { redirect } from 'next/navigation'
import { loadActivityList } from '@/lib/activity-list'
import { loadViewPrefs } from '@/app/actions/prefs'
import { getAccess } from '@/lib/auth/access'
import { ListaClient } from './ListaClient'

export default async function ListaPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ ws?: string; view?: string; persons?: string; statuses?: string; date?: string; resp?: string }>
}) {
  const { orgSlug } = await params
  const { ws, view, persons, statuses, date, resp } = await searchParams
  const archivedView = view === 'arquivadas'
  const csv = (s?: string) => (s ?? '').split(',').map(x => x.trim()).filter(Boolean)

  // A Lista global é ferramenta de quem coordena — owner/admin/manager (ou cargo
  // "vê tudo"). Quem executa trabalha pelo Atendimento, que já mostra só os status
  // do próprio cargo. O item some da sidebar, e a rota fecha aqui também: esconder
  // link não é permissão.
  const acesso = await getAccess(orgSlug)
  if (!acesso) redirect('/')
  if (!acesso.access.listaGlobal) redirect(`/${orgSlug}/views/atendimento`)

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
      initialRespEtapa={resp === 'etapa'}
      dbPrefs={dbPrefs}
      view={archivedView ? 'arquivadas' : 'ativas'}
    />
  )
}
