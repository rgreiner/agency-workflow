'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'

export interface ActivitySearchResult {
  id: string
  title: string
  status: string
  archived: boolean
  campaignId: string
  campaignName: string
  workspaceId: string
  workspaceName: string
}

export async function searchActivities(
  orgSlug: string,
  query: string,
  includeArchived = false,
): Promise<ActivitySearchResult[]> {
  const q = query.trim()
  if (q.length < 2) return []

  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return []

  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', orgSlug)
    .single()
  if (!org) return []

  // RPC com unaccent: ignora acentos e busca título + briefing.
  const { data } = await supabase.rpc('search_activities', {
    p_user_id: user.id,
    p_org_id: org.id,
    p_query: q,
    p_include_archived: includeArchived,
  })

  return (data ?? []).map(a => ({
    id: a.id,
    title: a.title,
    status: a.status,
    archived: a.archived,
    campaignId: a.campaign_id,
    campaignName: a.campaign_name,
    workspaceId: a.workspace_id,
    workspaceName: a.workspace_name,
  }))
}
