import { createClient } from '@/lib/supabase/server'
import { loadViewPrefs } from '@/app/actions/prefs'
import { GanttClient } from './GanttClient'

export default async function GanttPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ ws?: string }>
}) {
  const { orgSlug } = await params
  const { ws } = await searchParams
  const supabase = await createClient()

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return null

  const { data: members } = await supabase
    .from('organization_members')
    .select('profiles!user_id(id, full_name, avatar_url)')
    .eq('org_id', org.id)

  const { data: workspaces } = await supabase
    .from('workspaces').select('id, name').eq('org_id', org.id).neq('archived', true)
  const wsIds = workspaces?.map(w => w.id) ?? []

  const { data: campaigns } = wsIds.length
    ? await supabase.from('campaigns').select('id, name, workspace_id, workspaces(name)').in('workspace_id', wsIds).eq('archived', false)
    : { data: [] }
  const campIds = campaigns?.map(c => c.id) ?? []

  const { data: activities } = campIds.length
    ? await supabase.from('activities')
        .select('id, title, status, priority, start_date, due_date, campaign_id, activity_assignees(profiles(id, full_name, avatar_url))')
        .in('campaign_id', campIds)
        .eq('archived', false)
        .neq('status', 'concluido')
        .not('due_date', 'is', null)
        .order('start_date', { ascending: true, nullsFirst: false })
    : { data: [] }

  const campMap = Object.fromEntries(
    (campaigns ?? []).map(c => [c.id, {
      name: c.name,
      client: (c.workspaces as unknown as { name: string })?.name ?? '',
      workspaceId: c.workspace_id,
    }])
  )

  const profiles = (members ?? [])
    .map(m => m.profiles as unknown as { id: string; full_name: string | null; avatar_url: string | null })
    .filter(Boolean)

  const workspaceList = (workspaces ?? []).map(w => ({ id: w.id, name: w.name }))
  const dbPrefs = await loadViewPrefs(orgSlug, 'views/gantt')

  return (
    <GanttClient
      activities={(activities ?? []) as unknown as Parameters<typeof GanttClient>[0]['activities']}
      campMap={campMap}
      profiles={profiles}
      workspaces={workspaceList}
      orgSlug={orgSlug}
      initialWorkspace={ws}
      dbPrefs={dbPrefs}
    />
  )
}
