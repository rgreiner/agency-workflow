import { createClient } from '@/lib/supabase/server'
import { AtendimentoClient, type Activity as AtendimentoActivity } from './AtendimentoClient'

export default async function AtendimentoPage({
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
    .from('workspaces').select('id').eq('org_id', org.id).eq('archived', false)
  const wsIds = workspaces?.map(w => w.id) ?? []

  const { data: campaigns } = wsIds.length
    ? await supabase.from('campaigns').select('id, name, workspace_id, workspaces(name)').in('workspace_id', wsIds)
    : { data: [] }
  const campIds = campaigns?.map(c => c.id) ?? []

  const { data: activities } = campIds.length
    ? await supabase.from('activities')
        .select('id, title, status, priority, due_date, layout_url, campaign_id, updated_at, activity_assignees(profiles(full_name, avatar_url)), activity_comments(content, created_at, profiles(full_name))')
        .in('campaign_id', campIds)
        .eq('archived', false)
        .neq('status', 'concluido')
        .order('due_date', { ascending: true, nullsFirst: false })
    : { data: [] }

  const campMap = Object.fromEntries(
    (campaigns ?? []).map(c => [c.id, {
      name: c.name,
      client: (c.workspaces as unknown as { name: string })?.name ?? '',
      workspaceId: c.workspace_id,
    }])
  )

  return (
    <AtendimentoClient
      activities={(activities ?? []) as unknown as AtendimentoActivity[]}
      campMap={campMap}
      orgSlug={orgSlug}
    />
  )
}
