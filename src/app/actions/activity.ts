'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { provisionActivitiesDrive, moveActivityDrive } from '@/lib/drive-provision'
import { scheduleReview, reviewKindForAdvance } from '@/lib/review-gate'
import { scheduleRecurrence, isConclusion } from '@/lib/recurrence-gate'

/**
 * Move uma tarefa para outro projeto (campanha), inclusive de outro cliente da
 * mesma org. Leva a pasta do Drive junto (reparent em 2º plano via moveActivityDrive).
 */
export async function moveActivity(activityId: string, newCampaignId: string, orgSlug: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // pasta + título atuais (antes de mover) p/ o reparent no Drive
  const { data: act } = await supabase
    .from('activities')
    .select('title, drive_folder_id')
    .eq('id', activityId)
    .single()

  // RPC novo (ainda não está nos tipos gerados) — cast como o resto do app.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('move_activity', {
    p_user_id: user.id,
    p_activity_id: activityId,
    p_new_campaign_id: newCampaignId,
  })
  if (error) return { error: error.message }

  await moveActivityDrive(supabase, {
    activityId,
    title: (act as { title: string } | null)?.title ?? '',
    userId: user.id,
    oldFolderId: (act as { drive_folder_id: string | null } | null)?.drive_folder_id ?? null,
    newCampaignId,
  })

  revalidatePath(`/${orgSlug}`, 'layout')
  return { ok: true as const }
}

export async function createActivity(
  orgSlug: string,
  workspaceId: string,
  campaignId: string,
  formData: FormData
) {
  const supabase = await createClient()
  const user = await getUsuario()
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

  // Cria as pastas no Drive em 2º plano (se a campanha tiver pasta vinculada)
  await provisionActivitiesDrive(supabase, {
    campaignId, userId: user.id, items: [{ activityId: activityId as string, title }],
  })

  redirect(`/${orgSlug}/workspaces/${workspaceId}/campaigns/${campaignId}/activities/${activityId}`)
}

/**
 * Cria uma atividade inline (a partir da Lista, no fim de um grupo de status) —
 * sem redirecionar; revalida o path p/ a nova linha aparecer no grupo certo.
 */
export async function createActivityInline(
  path: string,
  campaignId: string,
  title: string,
  status: string,
) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const t = (title ?? '').trim()
  if (!t) return { error: 'Título obrigatório' }

  const { data: activityId, error } = await supabase.rpc('create_activity', {
    p_user_id: user.id,
    p_campaign_id: campaignId,
    p_title: t,
    p_description: '',
    p_status: status || 'briefing',
    p_priority: 'medium',
    p_complexity: 'medium',
    p_due_date: null,
    p_estimated_hours: null,
    p_start_date: null,
  })
  if (error) return { error: error.message }

  // Cria as pastas no Drive em 2º plano (se a campanha tiver pasta vinculada).
  await provisionActivitiesDrive(supabase, {
    campaignId, userId: user.id, items: [{ activityId: activityId as string, title: t }],
  })

  revalidatePath(path)
  return { id: activityId as string }
}

export async function updateActivityStatus(
  path: string,
  activityId: string,
  newStatus: string,
  comment: string
) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // Status atual — p/ detectar avanço a partir de Redação (gate de revisão).
  const { data: cur } = await supabase
    .from('activities').select('status').eq('id', activityId).single()
  const fromStatus = cur?.status ?? null

  const { error } = await supabase.rpc('update_activity_status', {
    p_user_id: user.id,
    p_activity_id: activityId,
    p_new_status: newStatus,
    p_comment: comment,
  })

  if (error) return { error: error.message }

  const reviewKind = reviewKindForAdvance(fromStatus, newStatus)
  if (reviewKind) {
    scheduleReview({ supabase, userId: user.id, activityId, kind: reviewKind, toStatus: newStatus })
  }
  if (isConclusion(fromStatus, newStatus)) {
    scheduleRecurrence({ supabase, userId: user.id, activityId })
  }
  revalidatePath(path)
}

export async function setActivityAssignees(
  path: string,
  activityId: string,
  status: string,
  userIds: string[]
) {
  const supabase = await createClient()
  const user = await getUsuario()
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

export async function updateActivityField(
  path: string,
  activityId: string,
  field: string,
  newValue: string | null,
) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { error } = await supabase.rpc('update_activity_field', {
    p_user_id: user.id,
    p_activity_id: activityId,
    p_field: field,
    p_value: newValue,
  })

  if (error) return { error: error.message }
  revalidatePath(path)
}

export async function updateActivityDates(
  activityId: string,
  startDate: string | null,
  dueDate: string | null,
) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { error } = await supabase.rpc('update_activity_dates', {
    p_user_id: user.id,
    p_activity_id: activityId,
    p_start_date: startDate,
    p_due_date: dueDate,
  })
  if (error) return { error: error.message }
  revalidatePath('/', 'layout')
}

/**
 * Define a recorrência do prazo. `recurrence` = frequência ('weekly'|'monthly'|
 * 'bimonthly'|'quarterly'|'semiannual'|'annual') ou null p/ desligar; `remaining`
 * = quantas vezes ainda repete (null = sem limite); `resetStatus` = status p/ onde
 * a tarefa volta ao recorrer (null = padrão 'briefing').
 */
export async function setActivityRecurrence(
  path: string,
  activityId: string,
  recurrence: string | null,
  remaining: number | null,
  resetStatus: string | null,
) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('set_activity_recurrence', {
    p_user_id: user.id,
    p_activity_id: activityId,
    p_recurrence: recurrence,
    p_remaining: remaining,
    p_reset_status: resetStatus,
  })
  if (error) return { error: error.message }
  revalidatePath(path)
}

export async function setActivityArchived(
  path: string,
  activityId: string,
  archived: boolean,
) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { error } = await supabase.rpc('set_activity_archived', {
    p_user_id: user.id,
    p_activity_id: activityId,
    p_archived: archived,
  })

  if (error) return { error: error.message }
  revalidatePath(path)
}

// ── Ações em lote (seleção múltipla na Lista) ───────────────────────────────
// Reusa os RPCs por item (security definer com checagem de permissão) em
// pequenos lotes paralelos, com um único revalidate ao final.
async function runChunked(
  ids: string[],
  fn: (id: string) => PromiseLike<{ error: { message: string } | null }>,
  size = 8,
): Promise<{ message: string } | null> {
  for (let i = 0; i < ids.length; i += size) {
    const res = await Promise.all(ids.slice(i, i + size).map(fn))
    const err = res.find(r => r.error)?.error
    if (err) return err
  }
  return null
}

export async function bulkUpdateStatus(path: string, ids: string[], newStatus: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // Status atuais — p/ disparar o gate de revisão nos que avançam a partir de Redação.
  const { data: curRows } = await supabase.from('activities').select('id, status').in('id', ids)
  const fromMap = new Map((curRows ?? []).map(r => [r.id, r.status as string]))

  const err = await runChunked(ids, id =>
    supabase.rpc('update_activity_status', {
      p_user_id: user.id, p_activity_id: id, p_new_status: newStatus, p_comment: '',
    }).then(r => ({ error: r.error })))
  if (err) return { error: err.message }

  for (const id of ids) {
    const from = fromMap.get(id) ?? null
    const reviewKind = reviewKindForAdvance(from, newStatus)
    if (reviewKind) {
      scheduleReview({ supabase, userId: user.id, activityId: id, kind: reviewKind, toStatus: newStatus })
    }
    if (isConclusion(from, newStatus)) {
      scheduleRecurrence({ supabase, userId: user.id, activityId: id })
    }
  }
  revalidatePath(path)
}

export async function bulkUpdateField(path: string, ids: string[], field: string, value: string | null) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  const err = await runChunked(ids, id =>
    supabase.rpc('update_activity_field', {
      p_user_id: user.id, p_activity_id: id, p_field: field, p_value: value,
    }).then(r => ({ error: r.error })))
  if (err) return { error: err.message }
  revalidatePath(path)
}

export async function bulkToggleAssignee(path: string, ids: string[], assigneeId: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  const err = await runChunked(ids, id =>
    supabase.rpc('toggle_activity_assignee', {
      p_user_id: user.id, p_activity_id: id, p_assignee_id: assigneeId,
    }).then(r => ({ error: r.error })))
  if (err) return { error: err.message }
  revalidatePath(path)
}

export async function bulkSetArchived(path: string, ids: string[], archived: boolean) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  const err = await runChunked(ids, id =>
    supabase.rpc('set_activity_archived', {
      p_user_id: user.id, p_activity_id: id, p_archived: archived,
    }).then(r => ({ error: r.error })))
  if (err) return { error: err.message }
  revalidatePath(path)
}

export async function addComment(
  path: string,
  activityId: string,
  content: string,
  mentionIds: string[] = [],
  mentionAll = false,
  replyTo: string | null = null,
) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { error } = await supabase.rpc('add_comment_with_mentions', {
    p_user_id: user.id,
    p_activity_id: activityId,
    p_content: content,
    p_mention_ids: mentionIds,
    p_mention_all: mentionAll,
    p_reply_to: replyTo,
  })

  if (error) return { error: error.message }
  revalidatePath(path)
}

/** Salva os links livres ("Mídia") do job — array [{label, url}]. */
export async function setActivityExtraLinks(
  path: string,
  activityId: string,
  links: { label: string; url: string }[],
) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const clean = (links ?? [])
    .map(l => ({ label: (l.label ?? '').trim(), url: (l.url ?? '').trim() }))
    .filter(l => l.url)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('set_activity_extra_links', {
    p_user_id: user.id, p_activity_id: activityId, p_links: clean,
  })
  if (error) return { error: error.message }
  revalidatePath(path)
}

/** Liga/desliga uma reação (emoji) do usuário num comentário. */
export async function toggleCommentReaction(path: string, commentId: string, emoji: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('toggle_comment_reaction', {
    p_user_id: user.id, p_comment_id: commentId, p_emoji: emoji,
  })
  if (error) return { error: error.message }
  revalidatePath(path)
}

/**
 * "Avançar mesmo assim" — assume os apontamentos da revisão e avança a tarefa para
 * o status que tentou antes (review_target), via RPC direto p/ não re-disparar a
 * revisão. Quem clica fica registrado no comentário (responsabilização).
 */
export async function confirmReviewErrors(path: string, activityId: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { data: act } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('activities').select('review_target, review_kind').eq('id', activityId).single() as any
  const target = act?.review_target || 'design'
  const kind = act?.review_kind || 'redacao'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).rpc('set_review', {
    p_user_id: user.id, p_activity_id: activityId, p_kind: kind, p_status: 'overridden', p_errors: null, p_target: null,
  })
  await supabase.rpc('add_activity_comment', {
    p_user_id: user.id, p_activity_id: activityId,
    p_content: '✋ Apontamentos da revisão assumidos — avançando mesmo assim.',
  })

  const { error } = await supabase.rpc('update_activity_status', {
    p_user_id: user.id, p_activity_id: activityId, p_new_status: target, p_comment: '',
  })
  if (error) return { error: error.message }
  revalidatePath(path)
}
