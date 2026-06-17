'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'

export interface NotificationItem {
  id: string
  type: string
  data: Record<string, unknown>
  readAt: string | null
  createdAt: string
  actorName: string | null
  title: string
  activityId: string | null
  campaignId: string | null
  workspaceId: string | null
}

export async function getNotifications(
  orgSlug: string,
): Promise<{ items: NotificationItem[]; unread: number }> {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { items: [], unread: 0 }

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { items: [], unread: 0 }

  const { data } = await supabase
    .from('notifications')
    .select('id, type, activity_id, data, read_at, created_at, actor:profiles!actor_id(full_name), activity:activities!activity_id(title, campaign_id, campaigns(workspace_id))')
    .eq('org_id', org.id)
    .order('created_at', { ascending: false })
    .limit(30)

  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', org.id)
    .is('read_at', null)

  const items: NotificationItem[] = (data ?? []).map(n => {
    const actor = n.actor as unknown as { full_name: string | null } | null
    const act = n.activity as unknown as {
      title: string; campaign_id: string; campaigns: { workspace_id: string } | null
    } | null
    return {
      id: n.id,
      type: n.type,
      data: (n.data as Record<string, unknown>) ?? {},
      readAt: n.read_at,
      createdAt: n.created_at,
      actorName: actor?.full_name ?? null,
      title: act?.title ?? 'Tarefa',
      activityId: n.activity_id,
      campaignId: act?.campaign_id ?? null,
      workspaceId: act?.campaigns?.workspace_id ?? null,
    }
  })

  return { items, unread: count ?? 0 }
}

export async function markNotificationRead(id: string): Promise<void> {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
}

export async function markAllNotificationsRead(orgSlug: string): Promise<void> {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return
  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('org_id', org.id)
    .is('read_at', null)
}
