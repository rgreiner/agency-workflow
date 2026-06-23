import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * Link curto/amigável de um job (tarefa) para compartilhar:
 *   /{orgSlug}/j/{activityId}
 * Resolve a campanha + cliente e redireciona para o caminho canônico.
 */
export default async function JobShortcut({
  params,
}: {
  params: Promise<{ orgSlug: string; activityId: string }>
}) {
  const { orgSlug, activityId } = await params
  const supabase = await createClient()

  const { data: a } = await supabase
    .from('activities')
    .select('campaign_id, campaigns(workspace_id)')
    .eq('id', activityId)
    .single()

  if (!a) notFound()
  const camp = Array.isArray(a.campaigns) ? a.campaigns[0] : a.campaigns
  const workspaceId = (camp as { workspace_id: string } | null)?.workspace_id
  if (!workspaceId || !a.campaign_id) notFound()

  redirect(`/${orgSlug}/workspaces/${workspaceId}/campaigns/${a.campaign_id}/activities/${activityId}`)
}
