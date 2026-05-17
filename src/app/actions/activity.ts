'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

export async function createActivity(
  orgSlug: string,
  workspaceId: string,
  campaignId: string,
  formData: FormData
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  const title = (formData.get('title') as string)?.trim()
  if (!title) return { error: 'Título obrigatório' }

  const start_date = formData.get('start_date') as string
  const due_date = formData.get('due_date') as string
  const estimated_hours = formData.get('estimated_hours') as string

  const { data: activityId, error } = await supabase.rpc('create_activity', {
    p_user_id: user.id,
    p_campaign_id: campaignId,
    p_title: title,
    p_description: (formData.get('description') as string) ?? '',
    p_status: (formData.get('status') as string) || 'briefing',
    p_priority: (formData.get('priority') as string) || 'medium',
    p_complexity: (formData.get('complexity') as string) || 'medium',
    p_due_date: due_date || null,
    p_estimated_hours: estimated_hours ? parseFloat(estimated_hours) : null,
    p_start_date: start_date || null,
  })

  if (error) return { error: error.message }

  // Salva campos de links (update direto, sem RLS issue pois usa a mesma sessão)
  const drive_folder_url = formData.get('drive_folder_url') as string
  const redacao_url = formData.get('redacao_url') as string
  const layout_url = formData.get('layout_url') as string
  const finalizacao_url = formData.get('finalizacao_url') as string
  const orcamento = formData.get('orcamento') as string

  if (drive_folder_url || redacao_url || layout_url || finalizacao_url || orcamento) {
    const { error: linksError } = await supabase.rpc('update_activity_links', {
      p_user_id: user.id,
      p_activity_id: activityId,
      p_drive_folder_url: drive_folder_url || null,
      p_redacao_url: redacao_url || null,
      p_layout_url: layout_url || null,
      p_finalizacao_url: finalizacao_url || null,
      p_orcamento: orcamento || null,
    })
    if (linksError) return { error: linksError.message }
  }

  redirect(`/${orgSlug}/workspaces/${workspaceId}/campaigns/${campaignId}/activities/${activityId}`)
}

export async function updateActivityStatus(
  path: string,
  activityId: string,
  newStatus: string,
  comment: string
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  const { error } = await supabase.rpc('update_activity_status', {
    p_user_id: user.id,
    p_activity_id: activityId,
    p_new_status: newStatus,
    p_comment: comment,
  })

  if (error) return { error: error.message }
  revalidatePath(path)
}

export async function setActivityAssignees(
  path: string,
  activityId: string,
  status: string,
  userIds: string[]
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  // Remove assignees for this activity+status then re-insert
  const { error: delError } = await supabase
    .from('activity_status_assignees')
    .delete()
    .eq('activity_id', activityId)
    .eq('status', status as never)

  if (delError) return { error: delError.message }

  if (userIds.length > 0) {
    const { error: insError } = await supabase
      .from('activity_status_assignees')
      .insert(userIds.map(userId => ({
        activity_id: activityId,
        status: status as never,
        user_id: userId,
      })))

    if (insError) return { error: insError.message }
  }

  revalidatePath(path)
  return {}
}

export async function addComment(
  path: string,
  activityId: string,
  content: string
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  const { error } = await supabase.rpc('add_activity_comment', {
    p_user_id: user.id,
    p_activity_id: activityId,
    p_content: content,
  })

  if (error) return { error: error.message }
  revalidatePath(path)
}
