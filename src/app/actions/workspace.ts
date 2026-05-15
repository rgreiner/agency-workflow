'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function createWorkspace(orgSlug: string, formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  const name = (formData.get('name') as string)?.trim()
  const description = (formData.get('description') as string) ?? ''
  const color = (formData.get('color') as string) || '#6366f1'

  if (!name) return { error: 'Nome obrigatório' }

  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', orgSlug)
    .single()

  if (!org) return { error: 'Organização não encontrada' }

  const { error } = await supabase.rpc('create_workspace', {
    p_user_id: user.id,
    p_org_id: org.id,
    p_name: name,
    p_description: description,
    p_color: color,
  })

  if (error) return { error: error.message }

  redirect(`/${orgSlug}/workspaces`)
}

export async function createCampaign(
  orgSlug: string,
  workspaceId: string,
  formData: FormData
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  const name = (formData.get('name') as string)?.trim()
  const description = (formData.get('description') as string) ?? ''
  const start_date = (formData.get('start_date') as string) || null
  const end_date = (formData.get('end_date') as string) || null

  if (!name) return { error: 'Nome obrigatório' }

  const { data: campaignId, error } = await supabase.rpc('create_campaign', {
    p_user_id: user.id,
    p_workspace_id: workspaceId,
    p_name: name,
    p_description: description,
    p_start_date: start_date,
    p_end_date: end_date,
  })

  if (error) return { error: error.message }

  redirect(`/${orgSlug}/workspaces/${workspaceId}/campaigns/${campaignId}`)
}
