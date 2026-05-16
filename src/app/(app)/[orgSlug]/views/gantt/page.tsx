import { createClient } from '@/lib/supabase/server'
import { GanttClient } from './GanttClient'

export default async function GanttPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const supabase = await createClient()

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return null

  const { data: members } = await supabase
    .from('organization_members')
    .select('profiles(id, full_name, avatar_url)')
    .eq('org_id', org.id)

  const { data: workspaces } = await supabase
    .from('workspaces').select('id').eq('org_id', org.id).eq('archived', false)
  const wsIds = workspaces?.map(w => w.id) ?? []

  const { data: campaigns } = wsIds.length
    ? await supabase.from('campaigns').select('id, name, workspace_id, workspaces(name)').in('workspace_id', wsIds)
    : { data: [] }
  const campIds = campaigns?.map(c => c.id) ?? []

  const { data: activities } = campIds.length
    ? await supabase.from('activities')
        .select('id, title, status, priority, due_date, campaign_id, activity_assignees(profiles(id, full_name, avatar_url))')
        .in('campaign_id', campIds)
        .neq('status', 'concluido')
        .not('due_date', 'is', null)
        .order('due_date', { ascending: true })
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

  return (
    <GanttClient
      activities={(activities ?? []) as unknown as Parameters<typeof GanttClient>[0]['activities']}
      campMap={campMap}
      profiles={profiles}
      orgSlug={orgSlug}
    />
  )
}
