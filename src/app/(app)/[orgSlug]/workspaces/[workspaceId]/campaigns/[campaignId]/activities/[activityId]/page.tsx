import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { STATUS_CONFIG, PRIORITY_CONFIG, COMPLEXITY_CONFIG, type ActivityPriority, type ActivityComplexity } from '@/types'
import { cn, formatDate, isOverdue } from '@/lib/utils'
import { AlertCircle, FolderOpen, FileText, Layers, CheckSquare, Pencil, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { StatusChanger } from './StatusChanger'
import { CommentBox } from './CommentBox'
import { AssigneeSelector } from './AssigneeSelector'
import { FieldEditor } from './FieldEditor'
import { ActivityHeader } from './ActivityHeader'
import { Avatar } from '@/components/ui/Avatar'

const FIELD_LABELS: Record<string, string> = {
  title:            'Título',
  description:      'Descrição',
  due_date:         'Prazo',
  start_date:       'Início',
  priority:         'Prioridade',
  complexity:       'Complexidade',
  estimated_hours:  'Horas est.',
  drive_folder_url: 'Drive',
  redacao_url:      'Redação',
  layout_url:       'Layout',
  finalizacao_url:  'Finalização',
  orcamento:        'Orçamento',
}

function formatFieldValue(field: string, val: string | null): string {
  if (val === null || val === '') return '—'
  if (field === 'priority')         return PRIORITY_CONFIG[val as ActivityPriority]?.label ?? val
  if (field === 'complexity')       return COMPLEXITY_CONFIG[val as ActivityComplexity]?.label ?? val
  if (field === 'due_date' || field === 'start_date') return formatDate(val)
  if (field === 'estimated_hours')  return `${val}h`
  if (field.endsWith('_url'))       return val.replace(/^https?:\/\//, '').slice(0, 32) + (val.length > 40 ? '…' : '')
  return val.length > 60 ? val.slice(0, 60) + '…' : val
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-400 shrink-0">{label}</span>
      <div className="text-right ml-2">{children}</div>
    </div>
  )
}

export default async function ActivityPage({
  params,
}: {
  params: Promise<{
    orgSlug: string; workspaceId: string; campaignId: string; activityId: string
  }>
}) {
  const { orgSlug, workspaceId, campaignId, activityId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

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
    .order('changed_at', { ascending: false })

  const { data: fieldHistory } = await supabase
    .from('activity_field_history')
    .select('*, profiles!changed_by(full_name, avatar_url)')
    .eq('activity_id', activityId)
    .order('changed_at', { ascending: false })

  const { data: comments } = await supabase
    .from('activity_comments')
    .select('*, profiles(full_name, avatar_url)')
    .eq('activity_id', activityId)
    .order('created_at', { ascending: true })

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('name, workspaces(org_id, name)')
    .eq('id', campaignId)
    .single()

  const ws = campaign?.workspaces as unknown as { org_id: string; name: string } | null
  const orgId = ws?.org_id

  // Check current user's org membership & role
  const { data: membership } = (user && orgId) ? await supabase
    .from('organization_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .single() : { data: null }

  const canManage  = ['owner', 'admin', 'manager'].includes(membership?.role ?? '')
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

  // Merge status history + field history, sort by date desc
  type HistoryKind =
    | { kind: 'status'; id: string; at: string; profile: { full_name: string | null; avatar_url: string | null } | null; from: string | null; to: string; comment: string | null }
    | { kind: 'field';  id: string; at: string; profile: { full_name: string | null; avatar_url: string | null } | null; field: string; oldVal: string | null; newVal: string | null }

  const unifiedHistory: HistoryKind[] = [
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
  ].sort((a, b) => b.at.localeCompare(a.at))

  const statusCfg    = STATUS_CONFIG.find((s) => s.value === activity.status)!
  const priorityCfg  = PRIORITY_CONFIG[activity.priority as ActivityPriority]
  const complexityCfg = COMPLEXITY_CONFIG[activity.complexity as ActivityComplexity]
  const overdue = isOverdue(activity.due_date)
  const hasFiles = !!(activity.drive_folder_url || activity.redacao_url || activity.layout_url || activity.finalizacao_url || activity.orcamento)

  const path = `/${orgSlug}/workspaces/${workspaceId}/campaigns/${campaignId}/activities/${activityId}`

  return (
    <div className="p-6">

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
        <Link href={`/${orgSlug}/views/lista`} className="hover:text-gray-600">Clientes</Link>
        <span>/</span>
        <Link href={`/${orgSlug}/workspaces/${workspaceId}`} className="hover:text-gray-600">{ws?.name ?? 'Cliente'}</Link>
        <span>/</span>
        <Link href={`/${orgSlug}/workspaces/${workspaceId}/campaigns/${campaignId}`} className="hover:text-gray-600">
          {campaign?.name}
        </Link>
        <span>/</span>
        <span className="text-gray-600 truncate max-w-xs">{activity.title}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* ── Main column ───────────────────────────────────── */}
        <div className="md:col-span-2 space-y-4">

          {/* Title + description — inline editable */}
          <ActivityHeader
            activityId={activityId}
            path={path}
            title={activity.title}
            description={activity.description}
            canManage={isOrgMember}
            isOrgMember={isOrgMember}
          />

          {/* Status changer */}
          <StatusChanger
            activityId={activityId}
            currentStatus={activity.status}
            path={path}
          />

          {/* Comments */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">
              Comentários {comments && comments.length > 0 && <span className="font-normal text-gray-400">({comments.length})</span>}
            </p>
            {comments && comments.length > 0 ? (
              <div className="space-y-4 mb-4">
                {comments.map((c) => {
                  const profile = c.profiles as { full_name: string | null; avatar_url: string | null } | null
                  return (
                    <div key={c.id} className="flex gap-3">
                      <Avatar name={profile?.full_name ?? '?'} avatarUrl={profile?.avatar_url} size="sm" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold text-gray-800">{profile?.full_name ?? 'Usuário'}</span>
                          <span className="text-xs text-gray-400">{formatDate(c.created_at)}</span>
                        </div>
                        <p className="text-sm text-gray-700 leading-relaxed">{c.content}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-400 mb-4">Nenhum comentário ainda.</p>
            )}
            <CommentBox activityId={activityId} path={path} />
          </div>

          {/* Unified history */}
          {unifiedHistory.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Histórico</p>
              <div className="space-y-2.5">
                {unifiedHistory.map((entry) => {
                  const profile = entry.profile
                  return (
                    <div key={entry.id} className="flex items-start gap-3 text-sm">
                      <Avatar name={profile?.full_name ?? '?'} avatarUrl={profile?.avatar_url} size="sm" />
                      <div className="flex-1 min-w-0">
                        {entry.kind === 'status' ? (
                          <>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-semibold text-gray-700">{profile?.full_name ?? 'Sistema'}</span>
                              <span className="text-xs text-gray-400">moveu de</span>
                              {(() => {
                                const from = STATUS_CONFIG.find(s => s.value === entry.from)
                                const to   = STATUS_CONFIG.find(s => s.value === entry.to)
                                return (
                                  <>
                                    {from
                                      ? <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded-full', from.bgColor, from.color)}>{from.label}</span>
                                      : <span className="text-xs text-gray-400">início</span>
                                    }
                                    <ArrowRight className="w-3 h-3 text-gray-300 shrink-0" />
                                    {to && <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded-full', to.bgColor, to.color)}>{to.label}</span>}
                                  </>
                                )
                              })()}
                            </div>
                            {entry.comment && <p className="text-xs text-gray-500 mt-0.5 italic">"{entry.comment}"</p>}
                          </>
                        ) : (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-semibold text-gray-700">{profile?.full_name ?? 'Sistema'}</span>
                            <Pencil className="w-3 h-3 text-gray-300 shrink-0" />
                            <span className="text-xs text-gray-400">
                              alterou <span className="font-medium text-gray-600">{FIELD_LABELS[entry.field] ?? entry.field}</span>
                            </span>
                            {entry.oldVal && (
                              <>
                                <span className="text-xs text-gray-300 line-through">{formatFieldValue(entry.field, entry.oldVal)}</span>
                                <ArrowRight className="w-3 h-3 text-gray-300 shrink-0" />
                              </>
                            )}
                            <span className="text-xs text-gray-700 font-medium">{formatFieldValue(entry.field, entry.newVal)}</span>
                          </div>
                        )}
                        <p className="text-[10px] text-gray-400 mt-0.5">{formatDate(entry.at)}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Right sidebar ─────────────────────────────────── */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">

            {/* Status badge */}
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <span className={cn('inline-flex px-2.5 py-1 rounded-full text-xs font-semibold', statusCfg.bgColor, statusCfg.color)}>
                {statusCfg.label}
              </span>
              {overdue && (
                <span className="flex items-center gap-1 text-xs text-red-500 font-medium">
                  <AlertCircle className="w-3 h-3" /> atrasada
                </span>
              )}
            </div>

            {/* Assignees */}
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Responsáveis</p>
              <AssigneeSelector
                activityId={activityId}
                assignedIds={assignedIds}
                members={members}
                path={path}
                compact
              />
            </div>

            {/* Prioridade */}
            <MetaRow label="Prioridade">
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
                  <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', priorityCfg.bgColor, priorityCfg.color)}>
                    {priorityCfg.label}
                  </span>
                }
              />
            </MetaRow>

            {/* Complexidade */}
            <MetaRow label="Complexidade">
              <FieldEditor
                activityId={activityId} path={path}
                field="complexity" value={activity.complexity} canEdit={isOrgMember}
                type="select"
                options={[
                  { value: 'simple',  label: 'Simples'   },
                  { value: 'medium',  label: 'Médio'     },
                  { value: 'complex', label: 'Complexo'  },
                ]}
                display={
                  <span className={cn('text-xs font-medium', complexityCfg.color)}>{complexityCfg.label}</span>
                }
              />
            </MetaRow>

            {/* Prazo */}
            <MetaRow label="Prazo">
              <FieldEditor
                activityId={activityId} path={path}
                field="due_date" value={activity.due_date} canEdit={isOrgMember}
                type="date"
                display={activity.due_date
                  ? <span className={cn('text-xs font-medium', overdue ? 'text-red-600' : 'text-gray-700')}>{formatDate(activity.due_date)}</span>
                  : undefined
                }
              />
            </MetaRow>

            {/* Início */}
            <MetaRow label="Início">
              <FieldEditor
                activityId={activityId} path={path}
                field="start_date" value={activity.start_date ?? null} canEdit={isOrgMember}
                type="date"
                display={activity.start_date
                  ? <span className="text-xs text-gray-700">{formatDate(activity.start_date)}</span>
                  : undefined
                }
              />
            </MetaRow>

            {/* Horas estimadas */}
            <MetaRow label="Horas est.">
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
              />
            </MetaRow>

            <MetaRow label="Criado em">
              <span className="text-xs text-gray-500">{formatDate(activity.created_at)}</span>
            </MetaRow>

            {/* Links / Arquivos */}
            <div className="border-t border-gray-100 px-4 py-3">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Arquivos e links</p>
              <div className="space-y-2">
                {(
                  [
                    { field: 'drive_folder_url', icon: <FolderOpen className="w-3.5 h-3.5" />, label: 'Drive',      canEdit: isOrgMember },
                    { field: 'redacao_url',       icon: <FileText   className="w-3.5 h-3.5" />, label: 'Redação',   canEdit: isOrgMember },
                    { field: 'layout_url',        icon: <CheckSquare className="w-3.5 h-3.5"/>, label: 'Layout',    canEdit: isOrgMember },
                    { field: 'finalizacao_url',   icon: <Layers     className="w-3.5 h-3.5" />, label: 'Finalização', canEdit: isOrgMember },
                  ] as const
                ).map(({ field, icon, label, canEdit }) => {
                  const url = activity[field as keyof typeof activity] as string | null
                  return (
                    <div key={field} className="flex items-center gap-2">
                      <span className="text-gray-400 shrink-0">{icon}</span>
                      <span className="text-gray-400 text-xs w-16 shrink-0">{label}</span>
                      <div className="flex-1 min-w-0">
                        {url ? (
                          <div className="flex items-center gap-1 group/link">
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-600 text-xs truncate hover:underline"
                            >
                              {url.replace(/^https?:\/\//, '').slice(0, 28)}{url.length > 35 ? '…' : ''}
                            </a>
                            {canEdit && (
                              <FieldEditor
                                activityId={activityId} path={path}
                                field={field} value={url} canEdit={canEdit}
                                type="url"
                                display={<span />}
                              />
                            )}
                          </div>
                        ) : (
                          <FieldEditor
                            activityId={activityId} path={path}
                            field={field} value={null} canEdit={canEdit}
                            type="url"
                          />
                        )}
                      </div>
                    </div>
                  )
                })}

                {/* Orçamento */}
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 text-xs w-[calc(1.75rem+0.5rem)] shrink-0">R$</span>
                  <span className="text-gray-400 text-xs w-16 shrink-0">Orçamento</span>
                  <div className="flex-1 min-w-0">
                    <FieldEditor
                      activityId={activityId} path={path}
                      field="orcamento" value={activity.orcamento ?? null} canEdit={isOrgMember}
                      type="text"
                      display={activity.orcamento
                        ? <span className="text-xs text-gray-700">{activity.orcamento}</span>
                        : undefined
                      }
                    />
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}
