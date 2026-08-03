import { createClient } from '@/lib/supabase/server'
import type { ActivityStatus } from '@/types'
import { commentPreview } from '@/lib/html'
import { porNome } from '@/lib/utils'

export interface LastComment {
  content: string
  at: string
  author: string | null
}

export interface ListActivity {
  id: string
  title: string
  status: string
  priority: string
  due_date: string | null
  start_date: string | null
  complexity: string | null
  redacao_url: string | null
  preview_url: string | null
  drive_path: string | null
  lastComment: LastComment | null
  campaign_id: string
  assignees: { full_name: string | null; avatar_url: string | null }[]
  assignedIds: string[]
  checklist: { done: number; total: number }
}

/** Conta itens feitos/total de um checklist jsonb [{id,text,done}]. */
export function checklistProgress(raw: unknown): { done: number; total: number } {
  const arr = Array.isArray(raw) ? (raw as { done?: boolean }[]) : []
  return { done: arr.filter(i => i?.done).length, total: arr.length }
}

export interface ListMember {
  userId: string
  fullName: string | null
  email: string
  avatarUrl: string | null
  /** Status que o CARGO da pessoa responde (org_positions.allowed_statuses).
   *  É a régua de "responsável pela etapa" que o dashboard de Gestão usa. */
  allowedStatuses: string[]
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
    /** Inclui também os 'concluido' na visão ativa (Lista = visão completa). */
    includeConcluido?: boolean
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
        .from('campaigns').select('id, name, workspace_id, workspaces(name)').in('workspace_id', wsIds).eq('archived', false).order('name')
      campaigns = (data ?? []) as unknown as CampRow[]
    }
  }
  const campIds = campaigns.map(c => c.id)

  const archivedView = !!opts.archived
  // checklist é coluna nova (não tipada nos types gerados) → query via cast.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any).from('activities')
    .select('id, title, status, priority, complexity, due_date, start_date, redacao_url, preview_url, drive_path, campaign_id, archived, checklist')
    .in('campaign_id', campIds)
    .eq('archived', archivedView)
  if (!archivedView && !opts.includeConcluido) q = q.neq('status', 'concluido')
  if (opts.statuses && opts.statuses.length) q = q.in('status', opts.statuses as ActivityStatus[])
  const { data: rawActivities } = campIds.length
    ? await q.order('due_date', { ascending: true, nullsFirst: false })
    : { data: [] }

  type ActRow = {
    id: string; title: string; status: string; priority: string; complexity: string | null
    due_date: string | null; start_date: string | null; redacao_url: string | null
    preview_url: string | null; drive_path: string | null; campaign_id: string; checklist: unknown
  }
  const rows = (rawActivities ?? []) as ActRow[]
  const actIds = rows.map(a => a.id)
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

  // Último comentário por atividade (coluna opcional na Lista).
  // Antes isto baixava TODOS os comentários de TODAS as tarefas e jogava fora
  // tudo menos o primeiro de cada — 490 linhas pra usar 111, crescendo sem teto,
  // e o custo era pago mesmo com a coluna desligada. A RPC faz
  // `distinct on (activity_id)` e devolve uma linha por tarefa (migration 188).
  const { data: commentsRaw } = actIds.length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? await (supabase as any).rpc('activity_last_comments', { p_ids: actIds })
    : { data: [] }

  const lastCommentMap: Record<string, LastComment> = {}
  for (const c of (commentsRaw ?? []) as { activity_id: string; content: string; created_at: string; author: string | null }[]) {
    lastCommentMap[c.activity_id] = {
      content: commentPreview(c.content),
      at: c.created_at,
      author: c.author ?? null,
    }
  }

  // `as any`: a coluna `arquivado` (migration 178) ainda não está nos tipos gerados.
  // Arquivado (saiu da agência) não entra em filtro nem em seletor de responsável —
  // o nome dele continua aparecendo no histórico das atividades em que trabalhou.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: membersRaw } = await (supabase as any)
    .from('organization_members')
    .select('user_id, profiles!user_id(full_name, email, avatar_url), org_positions(allowed_statuses)')
    .eq('org_id', org.id)
    .eq('arquivado', false)
  type MemberRaw = { user_id: string; profiles: unknown; org_positions: unknown }
  const members: ListMember[] = ((membersRaw ?? []) as MemberRaw[]).map(m => {
    const p = m.profiles as unknown as { full_name: string | null; email: string; avatar_url: string | null } | null
    const pos = m.org_positions as unknown as { allowed_statuses: string[] | null } | null
    return {
      userId: m.user_id as string, fullName: p?.full_name ?? null, email: p?.email ?? '',
      avatarUrl: p?.avatar_url ?? null, allowedStatuses: pos?.allowed_statuses ?? [],
    }
  }).filter(m => m.email || m.fullName).sort(porNome(m => m.fullName ?? m.email))

  const campMap = Object.fromEntries(
    (campaigns ?? []).map(c => [c.id, {
      name: c.name,
      client: (c.workspaces as unknown as { name: string })?.name ?? '',
      workspaceId: c.workspace_id,
    }])
  )

  const activities: ListActivity[] = rows.map(a => ({
    id: a.id,
    title: a.title,
    status: a.status,
    priority: a.priority,
    due_date: a.due_date,
    start_date: a.start_date,
    complexity: a.complexity,
    redacao_url: a.redacao_url,
    preview_url: a.preview_url,
    drive_path: a.drive_path,
    lastComment: lastCommentMap[a.id] ?? null,
    campaign_id: a.campaign_id,
    assignees: assigneeMap[a.id] ?? [],
    assignedIds: assignedIdsMap[a.id] ?? [],
    checklist: checklistProgress((a as { checklist?: unknown }).checklist),
  }))

  return { orgId: org.id, activities, campMap, members }
}
