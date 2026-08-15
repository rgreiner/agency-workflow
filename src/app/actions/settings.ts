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
    p_op_ver_tudo: formData.get('op_ver_tudo') === 'true',
    p_op_midias: formData.get('op_midias') === 'true',
    p_op_producao: formData.get('op_producao') === 'true',
    p_op_midia_hub: formData.get('op_midia_hub') === 'true',
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
    p_op_ver_tudo: formData.get('op_ver_tudo') === 'true',
    p_op_midias: formData.get('op_midias') === 'true',
    p_op_producao: formData.get('op_producao') === 'true',
    p_op_midia_hub: formData.get('op_midia_hub') === 'true',
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
  canRh?: boolean,
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
    p_can_rh: canRh ?? null,
  })

  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/settings/membros`)
}

/** O que está atribuído à pessoa nesta org — prévia antes de remover, para o
 *  admin decidir se transfere ou deixa sem responsável. */
export interface MembroCarga { user_id: string; ativas: number; atrasadas: number; so_dela: number }

export async function carregarCargaMembro(orgId: string, memberId: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('org_membro_carga', {
    p_org_id: orgId, p_member_id: memberId,
  })
  if (error) return { error: error.message }
  return { carga: data as MembroCarga }
}

/** Arquiva o membro (offboarding padrão): tira o acesso e o tira do operacional,
 *  mas MANTÉM o vínculo — o histórico e as métricas do que ele entregou seguem
 *  com dono. `transferirPara` leva as atividades ativas junto. */
export async function arquivarMembro(
  orgSlug: string, orgId: string, memberId: string,
  opts?: { arquivar?: boolean; transferirPara?: string | null },
) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('arquivar_membro', {
    p_org_id: orgId, p_member_id: memberId,
    p_arquivar: opts?.arquivar ?? true,
    p_transferir_para: opts?.transferirPara || null,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/settings/membros`)
  return { resultado: data as { arquivado: boolean; transferidas: number; soltas: number } }
}

/** Remove o membro DE VEZ (some da lista, perde o vínculo com o histórico).
 *  Use só para engano de convite; para quem saiu da agência, arquive. */
export async function removeMember(orgSlug: string, orgId: string, memberId: string, transferirPara?: string | null) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('remove_member', {
    p_user_id: user.id,
    p_org_id: orgId,
    p_member_id: memberId,
    p_transferir_para: transferirPara || null,
  })

  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/settings/membros`)
  return { resultado: data as { transferidas: number; soltas: number } }
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
