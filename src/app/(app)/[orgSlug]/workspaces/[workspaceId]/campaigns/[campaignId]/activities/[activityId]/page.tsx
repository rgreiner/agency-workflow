import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { notFound } from 'next/navigation'
import { getMergedStatusConfig, PRIORITY_CONFIG, COMPLEXITY_CONFIG, type ActivityPriority, type ActivityComplexity, type StatusOverride } from '@/types'
import { cn, formatDate, isOverdue } from '@/lib/utils'
import { AlertTriangle, FolderOpen, FileText, Layers, CheckSquare, ArrowRight, Pencil, ExternalLink, X } from 'lucide-react'
import Link from 'next/link'
import { DriveProvisioningNotice } from './DriveProvisioningNotice'
import { StatusChanger } from './StatusChanger'
import { ReviewBanner } from './ReviewBanner'
import { AutoRefresh } from '@/components/ui/AutoRefresh'
import { CommentBox } from './CommentBox'
import { AssigneeSelector } from './AssigneeSelector'
import { FieldEditor } from './FieldEditor'
import { ActivityHeader } from './ActivityHeader'
import { ShareJobButton } from './ShareJobButton'
import { ReactionBar } from './ReactionBar'
import { ReplyButton } from './ReplyButton'
import { ExtraLinks } from './ExtraLinks'
import { DateRangeEditor } from '@/components/ui/DateRangeEditor'
import { RecurrenceEditor } from '@/components/ui/RecurrenceEditor'
import { Avatar } from '@/components/ui/Avatar'
import { MachinePath } from '@/components/ui/MachinePath'

export default async function ActivityPage({
  params,
}: {
  params: Promise<{
    orgSlug: string; workspaceId: string; campaignId: string; activityId: string
  }>
}) {
  const { orgSlug, workspaceId, campaignId, activityId } = await params
  const supabase = await createClient()

  const user = await getUsuario()

  const { data: activity } = await supabase
    .from('activities')
    .select('*')
    .eq('id', activityId)
    .single()

  if (!activity) notFound()

  const { data: history } = await supabase
    .from('activity_history')
    .select('*, profiles(full_name, avatar_url)')
    .eq('activity_id', activityId)
    .order('changed_at', { ascending: true })

  const { data: fieldHistory } = await supabase
    .from('activity_field_history')
    .select('*, profiles!changed_by(full_name, avatar_url)')
    .eq('activity_id', activityId)
    .order('changed_at', { ascending: true })

  const { data: comments } = await supabase
    .from('activity_comments')
    .select('*, profiles(full_name, avatar_url)')
    .eq('activity_id', activityId)
    .order('created_at', { ascending: true })

  // Reações por comentário + mapa p/ resolver o comentário citado (responder).
  const commentIds = (comments ?? []).map(c => c.id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: reactionsRaw } = commentIds.length
    ? await sb.from('activity_comment_reactions').select('comment_id, user_id, emoji').in('comment_id', commentIds)
    : { data: [] }
  const reactionsByComment = new Map<string, { emoji: string; userId: string }[]>()
  for (const r of (reactionsRaw ?? []) as { comment_id: string; user_id: string; emoji: string }[]) {
    const arr = reactionsByComment.get(r.comment_id) ?? []
    arr.push({ emoji: r.emoji, userId: r.user_id })
    reactionsByComment.set(r.comment_id, arr)
  }
  const commentsById = new Map<string, { author: string; content: string }>()
  ;(comments ?? []).forEach(c => {
    const p = c.profiles as unknown as { full_name: string | null } | null
    commentsById.set(c.id, { author: p?.full_name ?? 'Usuário', content: c.content })
  })

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('name, drive_folder_id, workspaces(org_id, name)')
    .eq('id', campaignId)
    .single()

  // Pastas do Drive ainda sendo criadas em 2º plano (campanha vinculada, tarefa sem pasta)
  const drivePending = !!campaign?.drive_folder_id && !activity.drive_folder_id

  const ws = campaign?.workspaces as unknown as { org_id: string; name: string } | null
  const orgId = ws?.org_id

  const { data: membership } = (user && orgId) ? await supabase
    .from('organization_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .single() : { data: null }

  const isOrgMember = !!membership

  const { data: membersRaw } = orgId ? await supabase
    .from('organization_members')
    .select('user_id, profiles!user_id(id, full_name, email, avatar_url)')
    .eq('org_id', orgId) : { data: [] }

  const members = (membersRaw ?? []).map(m => {
    const p = m.profiles as unknown as { id: string; full_name: string | null; email: string; avatar_url: string | null } | null
    return { userId: m.user_id, fullName: p?.full_name ?? null, email: p?.email ?? '', avatarUrl: p?.avatar_url ?? null }
  })

  const { data: assigneesRaw } = await supabase
    .from('activity_assignees')
    .select('user_id')
    .eq('activity_id', activityId)

  const assignedIds = (assigneesRaw ?? []).map(a => a.user_id)

  // Merge comments + history into one feed, sorted ascending
  type FeedItem =
    | { kind: 'comment'; id: string; at: string; profile: { full_name: string | null; avatar_url: string | null } | null; content: string; replyTo: string | null }
    | { kind: 'status';  id: string; at: string; profile: { full_name: string | null; avatar_url: string | null } | null; from: string | null; to: string; comment: string | null }
    | { kind: 'field';   id: string; at: string; profile: { full_name: string | null; avatar_url: string | null } | null; field: string; oldVal: string | null; newVal: string | null }

  const FIELD_LABELS: Record<string, string> = {
    title: 'Título', description: 'Descrição', due_date: 'Prazo', start_date: 'Início',
    priority: 'Prioridade', complexity: 'Complexidade', estimated_hours: 'Horas est.',
    drive_folder_url: 'Drive', redacao_url: 'Redação', layout_url: 'Layout',
    finalizacao_url: 'Finalização', orcamento: 'Orçamento',
  }

  const feed: FeedItem[] = [
    ...(comments ?? []).map(c => ({
      kind: 'comment' as const,
      id: c.id,
      at: c.created_at,
      profile: c.profiles as { full_name: string | null; avatar_url: string | null } | null,
      content: c.content,
      replyTo: (c as { reply_to?: string | null }).reply_to ?? null,
    })),
    ...(history ?? []).map(h => ({
      kind: 'status' as const,
      id: h.id,
      at: h.changed_at,
      profile: h.profiles as unknown as { full_name: string | null; avatar_url: string | null } | null,
      from: h.from_status,
      to: h.to_status,
      comment: h.comment,
    })),
    ...(fieldHistory ?? []).map(h => ({
      kind: 'field' as const,
      id: h.id,
      at: h.changed_at,
      profile: h.profiles as { full_name: string | null; avatar_url: string | null } | null,
      field: h.field_name,
      oldVal: h.old_value,
      newVal: h.new_value,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at))

  // Cores de status seguem Configurações → Aparência (mescladas)
  const { data: orgRow } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawSettings } = await (supabase as any)
    .from('org_settings').select('status_overrides').eq('org_id', orgRow?.id).single()
  const statusConfig = getMergedStatusConfig((rawSettings?.status_overrides ?? []) as StatusOverride[])

  const priorityCfg  = PRIORITY_CONFIG[activity.priority as ActivityPriority]
  const complexityCfg = COMPLEXITY_CONFIG[activity.complexity as ActivityComplexity]
  const overdue = isOverdue(activity.due_date)

  const path = `/${orgSlug}/workspaces/${workspaceId}/campaigns/${campaignId}/activities/${activityId}`

  // extra_links é coluna nova (não tipada nos types gerados) → acesso por cast.
  const extraLinksRaw = (activity as { extra_links?: unknown }).extra_links
  const extraLinks = Array.isArray(extraLinksRaw) ? (extraLinksRaw as { label: string; url: string }[]) : []

  // "Drive" (a pasta) NÃO entra aqui — é o caminho da máquina (G:\ / Mac), logo
  // acima. Estes são os links web do Google Drive.
  const linkFields = [
    { field: 'redacao_url',      icon: <FileText   className="w-4 h-4" />, label: 'Redação' },
    { field: 'preview_url',      icon: <CheckSquare className="w-4 h-4"/>, label: 'Preview' },
    { field: 'finalizacao_url',  icon: <Layers     className="w-4 h-4" />, label: 'Final' },
  ] as const

  // Campo "Drive": caminho na máquina (drive_path) com fallback p/ drive_folder_url
  // quando este foi preenchido com um caminho (G:\…) em vez de URL. "Abrir no Drive"
  // só quando drive_folder_url é um URL de verdade.
  const driveUrlRaw   = (activity.drive_folder_url ?? '').trim()
  const driveWebUrl   = /^https?:\/\//i.test(driveUrlRaw) ? driveUrlRaw : null
  const driveLooksPath = /^[A-Za-z]:[\\/]/.test(driveUrlRaw) || driveUrlRaw.includes('\\')
  const driveWinPath  = (activity.drive_path ?? '').trim() || (driveLooksPath ? driveUrlRaw : '')

  return (
    <div className="flex flex-col bg-white lg:h-full lg:overflow-hidden">

      {/* ── Top bar ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-4 md:px-6 py-3 border-b border-gray-200 shrink-0 bg-white z-10">
        <Link href={`/${orgSlug}/views/lista`} className="hidden sm:block text-xs text-gray-500 hover:text-gray-600 transition">
          Clientes
        </Link>
        <span className="hidden sm:block text-gray-300 text-xs">/</span>
        <Link href={`/${orgSlug}/workspaces/${workspaceId}`} className="text-xs text-gray-500 hover:text-gray-600 transition">
          {ws?.name ?? 'Cliente'}
        </Link>
        <span className="text-gray-300 text-xs">/</span>
        <Link href={`/${orgSlug}/workspaces/${workspaceId}/campaigns/${campaignId}`} className="text-xs text-gray-500 hover:text-gray-600 transition">
          {campaign?.name}
        </Link>
        <span className="text-gray-300 text-xs">/</span>
        <span className="text-xs text-gray-600 truncate max-w-xs">{activity.title}</span>
        <div className="ml-auto flex items-center gap-3 text-xs text-gray-500 shrink-0">
          {overdue && (
            <span className="flex items-center gap-1 text-red-500 font-medium">
              <AlertTriangle className="w-3.5 h-3.5" /> Atrasada
            </span>
          )}
          <ShareJobButton orgSlug={orgSlug} activityId={activityId} title={activity.title} />
          <span className="hidden md:inline">Criada {formatDate(activity.created_at)}</span>
          <Link
            href={`/${orgSlug}/workspaces/${workspaceId}/campaigns/${campaignId}`}
            title="Fechar"
            className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {/* ── Body — stacks on mobile, side-by-side on lg+ ────────── */}
      <div className="flex flex-1 flex-col lg:flex-row lg:overflow-hidden">

        {/* ── Main content ─────────────────────────────────────── */}
        <div className="flex-1 lg:overflow-y-auto">
          <div className="px-4 md:px-8 py-6 max-w-3xl">

            {/* Título + meta (status/datas/prioridade/responsáveis) + briefing */}
            <ActivityHeader
              activityId={activityId}
              path={path}
              title={activity.title}
              description={activity.description}
              canManage={isOrgMember}
              isOrgMember={isOrgMember}
              meta={
                <>
                  {/* Status */}
                  <StatusChanger
                    activityId={activityId}
                    currentStatus={activity.status}
                    path={path}
                    compact
                  />

                  {/* Datas */}
                  <DateRangeEditor
                    activityId={activityId}
                    path={path}
                    startDate={activity.start_date ?? null}
                    dueDate={activity.due_date}
                    canEdit={isOrgMember}
                  />

                  {/* Recorrência do prazo */}
                  <RecurrenceEditor
                    key={`${activity.recurrence ?? ''}_${activity.recurrence_remaining ?? ''}_${activity.recurrence_reset_status ?? ''}`}
                    activityId={activityId}
                    path={path}
                    recurrence={activity.recurrence ?? null}
                    remaining={activity.recurrence_remaining ?? null}
                    resetStatus={activity.recurrence_reset_status ?? null}
                    canEdit={isOrgMember}
                  />

                  {/* Prioridade */}
                  <FieldEditor
                    activityId={activityId} path={path}
                    field="priority" value={activity.priority} canEdit={isOrgMember}
                    type="select"
                    options={[
                      { value: 'low',    label: 'Baixa'   },
                      { value: 'medium', label: 'Média'   },
                      { value: 'high',   label: 'Alta'    },
                      { value: 'urgent', label: 'Urgente' },
                    ]}
                    display={
                      <span className={cn('text-xs font-medium px-2.5 py-1 rounded-lg border', priorityCfg.bgColor, priorityCfg.color, 'border-transparent')}>
                        {priorityCfg.label}
                      </span>
                    }
                  />

                  {/* Responsáveis */}
                  <AssigneeSelector
                    activityId={activityId}
                    assignedIds={assignedIds}
                    members={members}
                    path={path}
                    compact
                  />
                </>
              }
            />

            {/* Atualiza a tarefa sozinha (revisão em 2º plano, mudanças de outros);
                mais rápido enquanto uma revisão está rodando. */}
            <AutoRefresh fast={activity.review_status === 'reviewing'} />

            {/* Revisão por IA (Redação/Design/Finalização) — "revisando…" / apontamentos + avançar mesmo assim */}
            <ReviewBanner
              activityId={activityId}
              path={path}
              status={activity.review_status ?? null}
              errors={(activity.review_errors as unknown as { trecho: string; problema: string; sugestao: string; tipo?: string }[] | null) ?? null}
              kind={activity.review_kind ?? null}
              currentStatus={activity.status}
            />

            {/* ── Campos ───────────────────────────────────────── */}
            <div className="mt-8">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Campos</p>
              {drivePending && <div className="mb-3"><DriveProvisioningNotice /></div>}
              <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">

                {/* Complexity */}
                <div className="flex items-center px-4 py-3 hover:bg-gray-50/60 transition group">
                  <span className="text-xs text-gray-500 w-36 shrink-0">Complexidade</span>
                  <FieldEditor
                    activityId={activityId} path={path}
                    field="complexity" value={activity.complexity} canEdit={isOrgMember}
                    type="select"
                    options={[
                      { value: 'simple',  label: 'Simples'  },
                      { value: 'medium',  label: 'Médio'    },
                      { value: 'complex', label: 'Complexo' },
                    ]}
                    display={
                      <span className={cn('text-xs font-medium', complexityCfg.color)}>{complexityCfg.label}</span>
                    }
                    inlineRow
                  />
                </div>

                {/* Estimated hours */}
                <div className="flex items-center px-4 py-3 hover:bg-gray-50/60 transition group">
                  <span className="text-xs text-gray-500 w-36 shrink-0">Horas estimadas</span>
                  <FieldEditor
                    activityId={activityId} path={path}
                    field="estimated_hours"
                    value={activity.estimated_hours != null ? String(activity.estimated_hours) : null}
                    canEdit={isOrgMember}
                    type="number"
                    display={activity.estimated_hours != null
                      ? <span className="text-xs text-gray-700">{activity.estimated_hours}h</span>
                      : undefined
                    }
                    inlineRow
                  />
                </div>

                {/* Drive — pasta de trabalho do job: caminho na máquina (editável, OS-aware) + abrir a raiz no Drive web */}
                <div className="flex items-center px-4 py-3 hover:bg-gray-50/60 transition group">
                  <div className="flex items-center gap-2 w-36 shrink-0">
                    <span className="text-gray-500"><FolderOpen className="w-4 h-4" /></span>
                    <span className="text-xs text-gray-500">Drive</span>
                  </div>
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <MachinePath winPath={driveWinPath} editable activityId={activityId} path={path} />
                    {driveWebUrl && (
                      <a
                        href={driveWebUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Abrir a pasta-raiz do job no Google Drive"
                        className="inline-flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 hover:underline shrink-0"
                      >
                        <ExternalLink className="w-3 h-3 shrink-0" />
                        Abrir no Drive
                      </a>
                    )}
                  </div>
                </div>

                {/* Link fields */}
                {linkFields.map(({ field, icon, label }) => {
                  const url = activity[field as keyof typeof activity] as string | null
                  return (
                    <div key={field} className="flex items-center px-4 py-3 hover:bg-gray-50/60 transition group">
                      <div className="flex items-center gap-2 w-36 shrink-0">
                        <span className="text-gray-500">{icon}</span>
                        <span className="text-xs text-gray-500">{label}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {url ? (
                          <>
                            <a href={url} target="_blank" rel="noopener noreferrer"
                              className="text-xs text-indigo-600 hover:underline truncate flex items-center gap-1">
                              <ExternalLink className="w-3 h-3 shrink-0" />
                              {url.replace(/^https?:\/\//, '').slice(0, 40)}{url.length > 47 ? '…' : ''}
                            </a>
                            <FieldEditor
                              activityId={activityId} path={path}
                              field={field} value={url} canEdit={isOrgMember}
                              type="url"
                              display={<span />}
                              inlineRow
                            />
                          </>
                        ) : (
                          <FieldEditor
                            activityId={activityId} path={path}
                            field={field} value={null} canEdit={isOrgMember}
                            type="url"
                            inlineRow
                          />
                        )}
                      </div>
                    </div>
                  )
                })}

                {/* Orçamento */}
                <div className="flex items-center px-4 py-3 hover:bg-gray-50/60 transition group">
                  <span className="text-xs text-gray-500 w-36 shrink-0">Orçamento</span>
                  <FieldEditor
                    activityId={activityId} path={path}
                    field="orcamento" value={activity.orcamento ?? null} canEdit={isOrgMember}
                    type="text"
                    display={activity.orcamento
                      ? <span className="text-xs text-gray-700">{activity.orcamento}</span>
                      : undefined
                    }
                    inlineRow
                  />
                </div>

              </div>
            </div>

            <ExtraLinks path={path} activityId={activityId} canEdit={isOrgMember} links={extraLinks} />
          </div>
        </div>

        {/* ── Activity feed — full-width below content on mobile ── */}
        <div className="w-full lg:w-[360px] border-t lg:border-t-0 lg:border-l border-gray-200 flex flex-col shrink-0 bg-gray-50/40">

          {/* Header */}
          <div className="px-5 py-3.5 border-b border-gray-200 bg-white shrink-0 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800">Atividade</h2>
            <span className="text-xs text-gray-500">{feed.length} registro{feed.length !== 1 ? 's' : ''}</span>
          </div>

          {/* Feed */}
          <div className="flex-1 lg:overflow-y-auto scrollbar-thin p-4 space-y-3">
            {feed.length === 0 && (
              <p className="text-xs text-gray-500 text-center py-8">Nenhuma atividade ainda.</p>
            )}

            {feed.map(item => {
              if (item.kind === 'comment') {
                return (
                  <div key={item.id} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                    <div className="flex items-start gap-3">
                      <Avatar name={item.profile?.full_name ?? '?'} avatarUrl={item.profile?.avatar_url} size="sm" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-xs font-semibold text-gray-800">{item.profile?.full_name ?? 'Usuário'}</span>
                          <span className="text-[10px] text-gray-500">{formatDate(item.at)}</span>
                        </div>
                        {item.replyTo && commentsById.has(item.replyTo) && (
                          <div className="mb-1.5 border-l-2 border-indigo-200 pl-2 py-0.5 bg-gray-50 rounded-r text-xs text-gray-500">
                            <span className="font-medium text-gray-600">{commentsById.get(item.replyTo)!.author}</span>
                            <span className="block line-clamp-2">{commentsById.get(item.replyTo)!.content}</span>
                          </div>
                        )}
                        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{item.content}</p>
                        <div className="flex items-center justify-between gap-3">
                          <ReactionBar path={path} commentId={item.id} currentUserId={user?.id ?? ''} reactions={reactionsByComment.get(item.id) ?? []} />
                          <div className="mt-2 shrink-0"><ReplyButton id={item.id} author={item.profile?.full_name ?? 'Usuário'} preview={item.content.slice(0, 80)} /></div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              }

              if (item.kind === 'status') {
                const fromCfg = statusConfig.find(s => s.value === item.from)
                const toCfg   = statusConfig.find(s => s.value === item.to)
                return (
                  <div key={item.id} className="flex items-start gap-2.5 text-xs text-gray-500 px-1">
                    <Avatar name={item.profile?.full_name ?? '?'} avatarUrl={item.profile?.avatar_url} size="sm" />
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap leading-relaxed">
                        <span className="font-medium text-gray-700">{item.profile?.full_name ?? 'Sistema'}</span>
                        <span>moveu de</span>
                        {fromCfg
                          ? <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold" style={{ backgroundColor: fromCfg.bg, color: fromCfg.text }}>{fromCfg.label}</span>
                          : <span className="text-gray-500">início</span>
                        }
                        <ArrowRight className="w-3 h-3 text-gray-300 shrink-0" />
                        {toCfg && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold" style={{ backgroundColor: toCfg.bg, color: toCfg.text }}>{toCfg.label}</span>}
                      </div>
                      {item.comment && (
                        <p className="text-[11px] text-gray-500 mt-1 italic whitespace-pre-wrap break-words">"{item.comment}"</p>
                      )}
                      <p className="text-[10px] text-gray-500 mt-0.5">{formatDate(item.at)}</p>
                    </div>
                  </div>
                )
              }

              // field change
              return (
                <div key={item.id} className="flex items-start gap-2.5 text-xs text-gray-500 px-1">
                  <Avatar name={item.profile?.full_name ?? '?'} avatarUrl={item.profile?.avatar_url} size="sm" />
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap leading-relaxed">
                      <span className="font-medium text-gray-700">{item.profile?.full_name ?? 'Sistema'}</span>
                      <Pencil className="w-3 h-3 text-gray-300 shrink-0" />
                      <span>alterou <span className="font-medium text-gray-600">{FIELD_LABELS[item.field] ?? item.field}</span></span>
                    </div>
                    {item.newVal && (
                      <p className="text-[11px] text-gray-500 mt-0.5">→ {item.newVal.slice(0, 60)}{item.newVal.length > 60 ? '…' : ''}</p>
                    )}
                    <p className="text-[10px] text-gray-500 mt-0.5">{formatDate(item.at)}</p>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Comment box */}
          <div className="border-t border-gray-200 p-4 bg-white shrink-0">
            <CommentBox
              activityId={activityId}
              path={path}
              members={members.map(m => ({ id: m.userId, name: m.fullName ?? m.email }))}
              assignedIds={assignedIds}
            />
          </div>
        </div>

      </div>
    </div>
  )
}
