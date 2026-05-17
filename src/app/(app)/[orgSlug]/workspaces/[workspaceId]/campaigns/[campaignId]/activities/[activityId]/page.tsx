import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { STATUS_CONFIG, PRIORITY_CONFIG, COMPLEXITY_CONFIG } from '@/types'
import { cn, formatDate, isOverdue } from '@/lib/utils'
import { AlertCircle, FolderOpen, FileText, Layers, CheckSquare, DollarSign, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { StatusChanger } from './StatusChanger'
import { CommentBox } from './CommentBox'
import { AssigneeSelector } from './AssigneeSelector'
import { Avatar } from '@/components/ui/Avatar'

function LinkRow({ icon, label, url }: { icon: React.ReactNode; label: string; url: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-2 group hover:bg-gray-50 rounded-lg -mx-1 px-1 py-1 transition">
      <span className="text-gray-400 shrink-0">{icon}</span>
      <span className="text-gray-400 text-xs w-16 shrink-0">{label}</span>
      <span className="text-indigo-600 text-xs truncate group-hover:underline flex items-center gap-1 min-w-0">
        <span className="truncate">{url.replace(/^https?:\/\//, '').slice(0, 28)}…</span>
        <ExternalLink className="w-3 h-3 shrink-0" />
      </span>
    </a>
  )
}

function MetaRow({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between px-4 py-2.5 border-b border-gray-100 last:border-0', className)}>
      <span className="text-xs text-gray-400 shrink-0">{label}</span>
      <div className="text-right">{children}</div>
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

  const statusCfg = STATUS_CONFIG.find((s) => s.value === activity.status)!
  const priorityCfg = PRIORITY_CONFIG[activity.priority]
  const complexityCfg = COMPLEXITY_CONFIG[activity.complexity]
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

      <div className="grid grid-cols-3 gap-6">

        {/* ── Coluna principal ──────────────────────────────── */}
        <div className="col-span-2 space-y-4">

          {/* Título + descrição */}
          <div>
            <h1 className="text-xl font-semibold text-gray-900 leading-snug mb-2">{activity.title}</h1>
            {activity.description && (
              <p className="text-gray-500 text-sm leading-relaxed">{activity.description}</p>
            )}
          </div>

          {/* Alterar status */}
          <StatusChanger
            activityId={activityId}
            currentStatus={activity.status}
            path={path}
          />

          {/* Comentários */}
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

          {/* Histórico */}
          {history && history.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Histórico</p>
              <div className="space-y-2.5">
                {history.map((h) => {
                  const toStatus = STATUS_CONFIG.find((s) => s.value === h.to_status)
                  const fromStatus = STATUS_CONFIG.find((s) => s.value === h.from_status)
                  const profile = h.profiles as unknown as { full_name: string | null; avatar_url: string | null } | null
                  return (
                    <div key={h.id} className="flex items-start gap-3 text-sm">
                      <Avatar name={profile?.full_name ?? '?'} avatarUrl={profile?.avatar_url} size="sm" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-semibold text-gray-700">{profile?.full_name ?? 'Sistema'}</span>
                          <span className="text-xs text-gray-400">moveu de</span>
                          {fromStatus
                            ? <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded-full', fromStatus.bgColor, fromStatus.color)}>{fromStatus.label}</span>
                            : <span className="text-xs text-gray-400">início</span>
                          }
                          <span className="text-xs text-gray-400">→</span>
                          {toStatus && <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded-full', toStatus.bgColor, toStatus.color)}>{toStatus.label}</span>}
                        </div>
                        {h.comment && <p className="text-xs text-gray-500 mt-0.5 italic">"{h.comment}"</p>}
                        <p className="text-[10px] text-gray-400 mt-0.5">{formatDate(h.changed_at)}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Sidebar direita — painel único ───────────────── */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">

            {/* Status */}
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

            {/* Responsáveis */}
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

            {/* Metadados em rows */}
            <MetaRow label="Prioridade">
              <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', priorityCfg.bgColor, priorityCfg.color)}>
                {priorityCfg.label}
              </span>
            </MetaRow>

            <MetaRow label="Complexidade">
              <span className={cn('text-xs font-medium', complexityCfg.color)}>{complexityCfg.label}</span>
            </MetaRow>

            <MetaRow label="Prazo" className={overdue ? 'bg-red-50' : ''}>
              {activity.due_date
                ? <span className={cn('text-xs font-medium', overdue ? 'text-red-600' : 'text-gray-700')}>
                    {formatDate(activity.due_date)}
                  </span>
                : <span className="text-xs text-gray-300">—</span>
              }
            </MetaRow>

            {activity.estimated_hours && (
              <MetaRow label="Horas est.">
                <span className="text-xs font-medium text-gray-700">{activity.estimated_hours}h</span>
              </MetaRow>
            )}

            <MetaRow label="Criado em">
              <span className="text-xs text-gray-500">{formatDate(activity.created_at)}</span>
            </MetaRow>

            {/* Arquivos */}
            {hasFiles && (
              <div className="border-t border-gray-100 px-4 py-3">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Arquivos</p>
                <div className="space-y-0.5">
                  {activity.drive_folder_url && (
                    <LinkRow icon={<FolderOpen className="w-3.5 h-3.5" />} label="Drive" url={activity.drive_folder_url} />
                  )}
                  {activity.redacao_url && (
                    <LinkRow icon={<FileText className="w-3.5 h-3.5" />} label="Redação" url={activity.redacao_url} />
                  )}
                  {activity.layout_url && (
                    <LinkRow icon={<Layers className="w-3.5 h-3.5" />} label="Layout" url={activity.layout_url} />
                  )}
                  {activity.finalizacao_url && (
                    <LinkRow icon={<CheckSquare className="w-3.5 h-3.5" />} label="Finalização" url={activity.finalizacao_url} />
                  )}
                  {activity.orcamento && (
                    <div className="flex items-center gap-2">
                      <DollarSign className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      <span className="text-gray-400 text-xs w-16 shrink-0">Orçamento</span>
                      <span className="text-gray-700 text-xs truncate">{activity.orcamento}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
