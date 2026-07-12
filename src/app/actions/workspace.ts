'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

/** Lê todos os campos do cadastro de cliente a partir do FormData. */
function readClientData(formData: FormData) {
  const get = (k: string) => ((formData.get(k) as string) ?? '').trim()
  return {
    name: get('name'),
    description: get('description'),
    color: get('color') || '#6366f1',
    legal_name: get('legal_name'),
    trade_name: get('trade_name'),
    tax_id: get('tax_id'),
    state_registration: get('state_registration'),
    city_registration: get('city_registration'),
    finance_email: get('finance_email'),
    phone: get('phone'),
    contact_name: get('contact_name'),
    address_zip: get('address_zip'),
    address_street: get('address_street'),
    address_number: get('address_number'),
    address_complement: get('address_complement'),
    address_district: get('address_district'),
    address_city: get('address_city'),
    address_state: get('address_state'),
    payment_terms: get('payment_terms'),
    atividade: get('atividade'),
  }
}

/** Blocos de contato (jsonb) enviados como JSON pelo ClientForm. */
function readContato(formData: FormData) {
  const j = (k: string) => { try { return JSON.parse((formData.get(k) as string) || '[]') } catch { return [] } }
  return { enderecos: j('enderecos'), telefones: j('telefones'), emails: j('emails'), contas_bancarias: j('contas_bancarias') }
}

export async function createWorkspace(orgSlug: string, formData: FormData) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const data = readClientData(formData)
  if (!data.name) return { error: 'Nome obrigatório' }

  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', orgSlug)
    .single()

  if (!org) return { error: 'Organização não encontrada' }

  const { data: workspaceId, error } = await supabase.rpc('create_workspace', {
    p_user_id: user.id,
    p_org_id: org.id,
    p_name: data.name,
    p_description: data.description,
    p_color: data.color,
  })

  if (error) return { error: error.message }

  // Salva os demais dados cadastrais (fiscais/contato/endereço).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: e2 } = await (supabase as any).rpc('update_workspace_cadastro', {
    p_user_id: user.id, p_workspace_id: workspaceId, p_data: { ...data, ...readContato(formData) },
  })
  if (e2) return { error: e2.message }
  if (formData.get('cobranca_auto') === 'true') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('workspaces').update({ cobranca_auto: true }).eq('id', workspaceId)
  }

  redirect(`/${orgSlug}/workspaces`)
}

export async function createCampaign(
  orgSlug: string,
  workspaceId: string,
  formData: FormData
) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const name = (formData.get('name') as string)?.trim()
  const description = (formData.get('description') as string) ?? ''
  const start_date = (formData.get('start_date') as string) || null
  const end_date = (formData.get('end_date') as string) || null
  const driveFolderId = extractDriveFolderId(formData.get('drive_folder') as string)

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

  if (driveFolderId) {
    await supabase.rpc('set_campaign_drive', {
      p_user_id: user.id, p_campaign_id: campaignId as string, p_drive_folder_id: driveFolderId,
    })
  }

  redirect(`/${orgSlug}/workspaces/${workspaceId}/campaigns/${campaignId}`)
}

/** Extrai o ID de uma pasta do Drive a partir de um link (ou ID puro). */
function extractDriveFolderId(input: string | null): string | null {
  const s = (input ?? '').trim()
  if (!s) return null
  const m = s.match(/\/folders\/([a-zA-Z0-9-_]+)/) || s.match(/[?&]id=([a-zA-Z0-9-_]+)/)
  if (m) return m[1]
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s
  return null
}

export async function setCampaignDrive(orgSlug: string, workspaceId: string, campaignId: string, driveLink: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const folderId = extractDriveFolderId(driveLink)
  const { error } = await supabase.rpc('set_campaign_drive', {
    p_user_id: user.id, p_campaign_id: campaignId, p_drive_folder_id: folderId,
  })
  if (error) return { error: error.message }
  // Link válido salvo → avisa na Caixa de entrada pra revisar a sincronização.
  if (folderId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).rpc('notify_drive_sync', { p_user_id: user.id, p_campaign_id: campaignId })
  }
  revalidatePath(`/${orgSlug}/workspaces/${workspaceId}/campaigns/${campaignId}`)
  return {}
}

export async function updateWorkspace(
  orgSlug: string,
  workspaceId: string,
  formData: FormData
) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const data = readClientData(formData)
  if (!data.name) return { error: 'Nome obrigatório' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('update_workspace_cadastro', {
    p_user_id: user.id, p_workspace_id: workspaceId, p_data: { ...data, ...readContato(formData) },
  })
  if (error) return { error: error.message }
  // Cobrança automática (opt-in por cliente) — direto na tabela (RLS: manager+).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('workspaces').update({ cobranca_auto: formData.get('cobranca_auto') === 'true' }).eq('id', workspaceId)
  revalidatePath(`/${orgSlug}/workspaces/${workspaceId}`)
  revalidatePath(`/${orgSlug}/workspaces`)
}

export async function deleteWorkspace(orgSlug: string, workspaceId: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { error } = await supabase.rpc('delete_workspace', {
    p_user_id: user.id, p_workspace_id: workspaceId,
  })
  if (error) return { error: error.message }
  revalidatePath('/', 'layout') // atualiza sidebar + listas (evita item fantasma)
  redirect(`/${orgSlug}/workspaces`)
}

export async function setWorkspaceArchived(orgSlug: string, workspaceId: string, archived: boolean) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { error } = await supabase.rpc('set_workspace_archived', {
    p_user_id: user.id, p_workspace_id: workspaceId, p_archived: archived,
  })
  if (error) return { error: error.message }
  revalidatePath('/', 'layout')
}

export async function updateCampaign(
  orgSlug: string,
  workspaceId: string,
  campaignId: string,
  formData: FormData
) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const name = (formData.get('name') as string)?.trim()
  const description = (formData.get('description') as string) ?? ''
  const start_date = (formData.get('start_date') as string) || null
  const end_date = (formData.get('end_date') as string) || null
  if (!name) return { error: 'Nome obrigatório' }

  const { error } = await supabase.rpc('update_campaign', {
    p_user_id: user.id, p_campaign_id: campaignId,
    p_name: name, p_description: description,
    p_start_date: start_date, p_end_date: end_date,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/workspaces/${workspaceId}/campaigns/${campaignId}`)
}

export async function deleteCampaign(
  orgSlug: string,
  workspaceId: string,
  campaignId: string
) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { error } = await supabase.rpc('delete_campaign', {
    p_user_id: user.id, p_campaign_id: campaignId,
  })
  if (error) return { error: error.message }
  revalidatePath('/', 'layout') // atualiza sidebar + listas
  redirect(`/${orgSlug}/workspaces/${workspaceId}`)
}

export async function setCampaignArchived(orgSlug: string, workspaceId: string, campaignId: string, archived: boolean) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { error } = await supabase.rpc('set_campaign_archived', {
    p_user_id: user.id, p_campaign_id: campaignId, p_archived: archived,
  })
  if (error) return { error: error.message }
  revalidatePath('/', 'layout')
}
