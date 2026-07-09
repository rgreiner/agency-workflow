'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'
import type { ActivityStatus, MemberRole } from '@/types'

// ── CARGOS ──────────────────────────────────────

export async function createPosition(orgSlug: string, formData: FormData) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }

  const name = (formData.get('name') as string)?.trim()
  const color = (formData.get('color') as string) || '#6366f1'
  const statuses = formData.getAll('statuses') as ActivityStatus[]

  if (!name) return { error: 'Nome obrigatório' }

  const { error } = await supabase.rpc('create_org_position', {
    p_user_id: user.id,
    p_org_id: org.id,
    p_name: name,
    p_color: color,
    p_allowed_statuses: statuses,
  })

  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/settings/cargos`)
}

export async function updatePosition(orgSlug: string, positionId: string, formData: FormData) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const name = (formData.get('name') as string)?.trim()
  const color = (formData.get('color') as string) || '#6366f1'
  const statuses = formData.getAll('statuses') as ActivityStatus[]

  if (!name) return { error: 'Nome obrigatório' }

  const { error } = await supabase.rpc('update_org_position', {
    p_user_id: user.id,
    p_position_id: positionId,
    p_name: name,
    p_color: color,
    p_allowed_statuses: statuses,
  })

  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/settings/cargos`)
}

export async function deletePosition(orgSlug: string, positionId: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { error } = await supabase.rpc('delete_org_position', {
    p_user_id: user.id,
    p_position_id: positionId,
  })

  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/settings/cargos`)
}

// ── MEMBROS ──────────────────────────────────────

export async function updateMember(
  orgSlug: string,
  orgId: string,
  memberId: string,
  positionId: string | null,
  role: MemberRole,
  canFinance?: boolean,
  canVendas?: boolean,
) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('update_member', {
    p_user_id: user.id,
    p_org_id: orgId,
    p_member_id: memberId,
    p_position_id: positionId,
    p_role: role,
    p_can_finance: canFinance ?? null,
    p_can_vendas: canVendas ?? null,
  })

  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/settings/membros`)
}

export async function removeMember(orgSlug: string, orgId: string, memberId: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { error } = await supabase.rpc('remove_member', {
    p_user_id: user.id,
    p_org_id: orgId,
    p_member_id: memberId,
  })

  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/settings/membros`)
}

// ── CONVITES ──────────────────────────────────────

export async function getOrCreateInviteLink(
  orgSlug: string,
  orgId: string
): Promise<{ token?: string; error?: string }> {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { data, error } = await supabase.rpc('upsert_invite_link', {
    p_user_id: user.id,
    p_org_id: orgId,
    p_role: 'member',
  })

  if (error) return { error: error.message }
  return { token: data as string }
}

export async function deactivateInviteLink(
  orgSlug: string,
  orgId: string
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { error } = await supabase.rpc('deactivate_invite_link', {
    p_user_id: user.id,
    p_org_id: orgId,
  })

  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/settings/membros`)
  return {}
}

/** Admin/owner troca o avatar de um membro da org (tela Membros). */
export async function setMemberAvatar(orgSlug: string, orgId: string, targetUserId: string, avatarUrl: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('set_member_avatar', {
    p_user_id:    user.id,
    p_org_id:     orgId,
    p_target:     targetUserId,
    p_avatar_url: avatarUrl,
  })

  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/settings/membros`)
  return {}
}
