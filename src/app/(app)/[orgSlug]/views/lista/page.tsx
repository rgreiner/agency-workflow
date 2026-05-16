import { createClient } from '@/lib/supabase/server'
import { STATUS_CONFIG } from '@/types'
import { ListaClient } from './ListaClient'

export default async function ListaPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const supabase = await createClient()

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return null

  const { data: workspaces } = await supabase
    .from('workspaces').select('id').eq('org_id', org.id).neq('archived', true)
  const wsIds = workspaces?.map(w => w.id) ?? []

  const { data: campaigns } = wsIds.length
    ? await supabase.from('campaigns').select('id, name, workspace_id, workspaces(name)').in('workspace_id', wsIds)
    : { data: [] }
  const campIds = campaigns?.map(c => c.id) ?? []

  // Query activities sem join — evita falha total se schema cache estiver desatualizado
  const { data: rawActivities } = campIds.length
    ? await supabase.from('activities')
        .select('id, title, status, priority, complexity, due_date, start_date, layout_url, campaign_id')
        .in('campaign_id', campIds)
        .neq('status', 'concluido')
        .order('due_date', { ascending: true, nullsFirst: false })
    : { data: [] }

  // Query de responsáveis separada — se falhar, atividades continuam aparecendo
  const actIds = (rawActivities ?? []).map(a => a.id)
  const { data: assigneesData } = actIds.length
    ? await supabase
        .from('activity_assignees')
        .select('activity_id, profiles(full_name, avatar_url)')
        .in('activity_id', actIds)
    : { data: [] }

  // Agrupa responsáveis por atividade
  const assigneeMap = (assigneesData ?? []).reduce((acc, a) => {
    const profile = a.profiles as unknown as { full_name: string | null; avatar_url: string | null } | null
    if (!acc[a.activity_id]) acc[a.activity_id] = []
    if (profile) acc[a.activity_id].push(profile)
    return acc
  }, {} as Record<string, { full_name: string | null; avatar_url: string | null }[]>)

  const campMap = Object.fromEntries(
    (campaigns ?? []).map(c => [c.id, {
      name: c.name,
      client: (c.workspaces as unknown as { name: string })?.name ?? '',
      workspaceId: c.workspace_id,
    }])
  )

  const activities = (rawActivities ?? []).map(a => ({
    ...a,
    assignees: assigneeMap[a.id] ?? [],
  }))

  const grouped = STATUS_CONFIG.reduce((acc, s) => {
    const items = activities.filter(a => a.status === s.value)
    if (items.length > 0) acc[s.value] = items
    return acc
  }, {} as Record<string, typeof activities>)

  return (
    <ListaClient
      orgSlug={orgSlug}
      activities={activities}
      campMap={campMap}
      grouped={grouped}
      statusConfig={STATUS_CONFIG}
    />
  )
}
