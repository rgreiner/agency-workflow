'use server'

import { createClient } from '@/lib/supabase/server'

export interface ActivitySearchResult {
  id: string
  title: string
  status: string
  campaignId: string
  campaignName: string
  workspaceId: string
  workspaceName: string
}

export async function searchActivities(
  orgSlug: string,
  query: string
): Promise<ActivitySearchResult[]> {
  const q = query.trim()
  if (q.length < 2) return []

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', orgSlug)
    .single()
  if (!org) return []

  const { data } = await supabase
    .from('activities')
    .select('id, title, status, campaign_id, campaigns!inner(name, workspace_id, workspaces!inner(name, org_id))')
    .eq('campaigns.workspaces.org_id', org.id)
    .ilike('title', `%${q}%`)
    .order('updated_at', { ascending: false })
    .limit(8)

  return (data ?? []).map(a => {
    const camp = a.campaigns as unknown as {
      name: string
      workspace_id: string
      workspaces: { name: string }
    }
    return {
      id: a.id,
      title: a.title,
      status: a.status,
      campaignId: a.campaign_id,
      campaignName: camp.name,
      workspaceId: camp.workspace_id,
      workspaceName: camp.workspaces.name,
    }
  })
}
