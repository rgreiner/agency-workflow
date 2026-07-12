import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { loadActivityList } from '@/lib/activity-list'
import { loadViewPrefs } from '@/app/actions/prefs'
import { ListaClient } from '../lista/ListaClient'

/**
 * Tela de trabalho do CARGO do usuário: título = nome do cargo, lista filtrada
 * apenas para os status que o cargo enxerga (org_positions.allowed_statuses).
 * Reusa o mesmo padrão da Lista.
 */
export default async function AtendimentoPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ ws?: string; view?: string }>
}) {
  const { orgSlug } = await params
  const { ws, view } = await searchParams
  const archivedView = view === 'arquivadas'

  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return null

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return null

  // Cargo do usuário + status que ele enxerga
  const { data: membership } = await supabase
    .from('organization_members')
    .select('position_id, org_positions(name, allowed_statuses)')
    .eq('org_id', org.id)
    .eq('user_id', user.id)
    .single()
  const position = (membership?.org_positions ?? null) as unknown as
    { name: string; allowed_statuses: string[] } | null

  // Com cargo: filtra só os status do cargo. Sem cargo (ex.: owner "acesso total"):
  // mostra tudo, com o título "Atendimento".
  const data = await loadActivityList(orgSlug, {
    ws,
    archived: archivedView,
    statuses: position?.allowed_statuses,
  })
  if (!data) return null
  const dbPrefs = await loadViewPrefs(orgSlug, 'views/atendimento')

  return (
    <ListaClient
      orgSlug={orgSlug}
      activities={data.activities}
      campMap={data.campMap}
      members={data.members}
      initialWorkspace={ws}
      dbPrefs={dbPrefs}
      view={archivedView ? 'arquivadas' : 'ativas'}
      title={position?.name ?? 'Atendimento'}
      routeBase="views/atendimento"
    />
  )
}
