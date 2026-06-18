import { createClient } from '@/lib/supabase/server'
import type { ActivityStatus } from '@/types'

export interface ListActivity {
  id: string
  title: string
  status: string
  priority: string
  due_date: string | null
  start_date: string | null
  complexity: string | null
  layout_url: string | null
  campaign_id: string
  assignees: { full_name: string | null; avatar_url: string | null }[]
  assignedIds: string[]
}

export interface ListMember {
  userId: string
  fullName: string | null
  email: string
  avatarUrl: string | null
}

export interface ActivityListData {
  orgId: string
  activities: ListActivity[]
  campMap: Record<string, { name: string; client: string; workspaceId: string }>
  members: ListMember[]
}

/**
 * Carrega os dados da lista de atividades de uma org (usado pela Lista e pela
 * tela de trabalho por cargo). `opts.statuses` restringe aos status informados.
 */
export async function loadActivityList(
  orgSlug: string,
  opts: {
    ws?: string
    archived?: boolean
    statuses?: string[]
    /** Escopo: apenas este cliente (inclui workspace arquivado, campanhas ativas). */
    scopeWorkspaceId?: string
    /** Escopo: apenas esta campanha (inclui campanha arquivada). */
    scopeCampaignId?: string
  } = {},
): Promise<ActivityListData | null> {
  const supabase = await createClient()

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return null

  type CampRow = { id: string; name: string; workspace_id: string; workspaces: { name: string } | null }
  let campaigns: CampRow[] = []
  if (opts.scopeCampaignId) {
    // Página da campanha: só esta campanha (mesmo se arquivada).
    const { data } = await supabase
      .from('campaigns').select('id, name, workspace_id, workspaces(name)').eq('id', opts.scopeCampaignId)
    campaigns = (data ?? []) as unknown as CampRow[]
  } else {
    // Página do cliente (escopo a 1 workspace, mesmo arquivado) ou visão geral
    // (todos os clientes ativos). Campanhas arquivadas sempre escondidas aqui.
    let wsQ = supabase.from('workspaces').select('id').eq('org_id', org.id)
    wsQ = opts.scopeWorkspaceId ? wsQ.eq('id', opts.scopeWorkspaceId) : wsQ.neq('archived', true)
    const { data: workspaces } = await wsQ
    const wsIds = workspaces?.map(w => w.id) ?? []
    if (wsIds.length) {
      const { data } = await supabase
        .from('campaigns').select('id, name, workspace_id, workspaces(name)').in('workspace_id', wsIds).eq('archived', false)
      campaigns = (data ?? []) as unknown as CampRow[]
    }
  }
  const campIds = campaigns.map(c => c.id)

  const archivedView = !!opts.archived
  let q = supabase.from('activities')
    .select('id, title, status, priority, complexity, due_date, start_date, layout_url, campaign_id, archived')
    .in('campaign_id', campIds)
    .eq('archived', archivedView)
  if (!archivedView) q = q.neq('status', 'concluido')
  if (opts.statuses && opts.statuses.length) q = q.in('status', opts.statuses as ActivityStatus[])
  const { data: rawActivities } = campIds.length
    ? await q.order('due_date', { ascending: true, nullsFirst: false })
    : { data: [] }

  const actIds = (rawActivities ?? []).map(a => a.id)
  const { data: assigneesData } = actIds.length
    ? await supabase.from('activity_assignees')
        .select('activity_id, user_id, profiles(full_name, avatar_url)')
        .in('activity_id', actIds)
    : { data: [] }

  const assigneeMap = (assigneesData ?? []).reduce((acc, a) => {
    const profile = a.profiles as unknown as { full_name: string | null; avatar_url: string | null } | null
    if (!acc[a.activity_id]) acc[a.activity_id] = []
    if (profile) acc[a.activity_id].push(profile)
    return acc
  }, {} as Record<string, { full_name: string | null; avatar_url: string | null }[]>)

  const assignedIdsMap = (assigneesData ?? []).reduce((acc, a) => {
    if (!acc[a.activity_id]) acc[a.activity_id] = []
    acc[a.activity_id].push((a as { user_id: string }).user_id)
    return acc
  }, {} as Record<string, string[]>)

  const { data: membersRaw } = await supabase
    .from('organization_members')
    .select('user_id, profiles!user_id(full_name, email, avatar_url)')
    .eq('org_id', org.id)
  const members: ListMember[] = (membersRaw ?? []).map(m => {
    const p = m.profiles as unknown as { full_name: string | null; email: string; avatar_url: string | null } | null
    return { userId: m.user_id as string, fullName: p?.full_name ?? null, email: p?.email ?? '', avatarUrl: p?.avatar_url ?? null }
  }).filter(m => m.email || m.fullName)

  const campMap = Object.fromEntries(
    (campaigns ?? []).map(c => [c.id, {
      name: c.name,
      client: (c.workspaces as unknown as { name: string })?.name ?? '',
      workspaceId: c.workspace_id,
    }])
  )

  const activities: ListActivity[] = (rawActivities ?? []).map(a => ({
    id: a.id,
    title: a.title,
    status: a.status,
    priority: a.priority,
    due_date: a.due_date,
    start_date: a.start_date,
    complexity: a.complexity,
    layout_url: a.layout_url,
    campaign_id: a.campaign_id,
    assignees: assigneeMap[a.id] ?? [],
    assignedIds: assignedIdsMap[a.id] ?? [],
  }))

  return { orgId: org.id, activities, campMap, members }
}
