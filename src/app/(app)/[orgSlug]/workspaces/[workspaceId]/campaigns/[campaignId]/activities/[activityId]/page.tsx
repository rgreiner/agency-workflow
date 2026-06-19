import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { notFound } from 'next/navigation'
import { getMergedStatusConfig, PRIORITY_CONFIG, COMPLEXITY_CONFIG, type ActivityPriority, type ActivityComplexity, type StatusOverride } from '@/types'
import { cn, formatDate, isOverdue } from '@/lib/utils'
import { AlertTriangle, FolderOpen, FileText, Layers, CheckSquare, ArrowRight, Pencil, ExternalLink, HardDrive } from 'lucide-react'
import Link from 'next/link'
import { CopyButton } from '@/components/ui/CopyButton'
import { DriveProvisioningNotice } from './DriveProvisioningNotice'
import { StatusChanger } from './StatusChanger'
import { CommentBox } from './CommentBox'
import { AssigneeSelector } from './AssigneeSelector'
import { FieldEditor } from './FieldEditor'
import { ActivityHeader } from './ActivityHeader'
import { DateRangeEditor } from '@/components/ui/DateRangeEditor'
import { Avatar } from '@/components/ui/Avatar'

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
    | { kind: 'comment'; id: string; at: string; profile: { full_name: string | null; avatar_url: string | null } | null; content: string }
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

  const linkFields = [
    { field: 'drive_folder_url', icon: <FolderOpen className="w-4 h-4" />, label: 'Drive' },
    { field: 'redacao_url',      icon: <FileText   className="w-4 h-4" />, label: 'Redação' },
    { field: 'preview_url',      icon: <CheckSquare className="w-4 h-4"/>, label: 'Preview' },
    { field: 'finalizacao_url',  icon: <Layers     className="w-4 h-4" />, label: 'Final' },
  ] as const

  return (
    <div className="flex flex-col bg-white lg:h-screen lg:overflow-hidden">

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
          <span className="hidden md:inline">Criada {formatDate(activity.created_at)}</span>
        </div>
      </div>

      {/* ── Body — stacks on mobile, side-by-side on lg+ ────────── */}
      <div className="flex flex-1 flex-col lg:flex-row lg:overflow-hidden">

        {/* ── Main content ─────────────────────────────────────── */}
        <div className="flex-1 lg:overflow-y-auto">
          <div className="px-4 md:px-8 py-6 max-w-3xl">

            {/* Title + description */}
            <ActivityHeader
              activityId={activityId}
              path={path}
              title={activity.title}
              description={activity.description}
              canManage={isOrgMember}
              isOrgMember={isOrgMember}
            />

            {/* Meta strip */}
            <div className="flex items-center gap-3 mt-5 flex-wrap">

              {/* Status */}
              <StatusChanger
                activityId={activityId}
                currentStatus={activity.status}
                path={path}
                compact
              />

              {/* Dates */}
              <DateRangeEditor
                activityId={activityId}
                path={path}
                startDate={activity.start_date ?? null}
                dueDate={activity.due_date}
                canEdit={isOrgMember}
              />

              {/* Priority */}
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

              {/* Assignees */}
              <AssigneeSelector
                activityId={activityId}
                assignedIds={assignedIds}
                members={members}
                path={path}
                compact
              />
            </div>

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

                {/* Caminho na máquina (Drive Desktop) */}
                {activity.drive_path && (
                  <div className="flex items-center px-4 py-3 hover:bg-gray-50/60 transition group">
                    <div className="flex items-center gap-2 w-36 shrink-0">
                      <span className="text-gray-500"><HardDrive className="w-4 h-4" /></span>
                      <span className="text-xs text-gray-500">Caminho na máquina</span>
                    </div>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-xs text-gray-600 font-mono truncate">{activity.drive_path}</span>
                      <CopyButton text={activity.drive_path} label="Copiar caminho" />
                    </div>
                  </div>
                )}

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
                        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{item.content}</p>
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
            <CommentBox activityId={activityId} path={path} />
          </div>
        </div>

      </div>
    </div>
  )
}
