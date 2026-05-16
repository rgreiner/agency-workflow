import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { STATUS_CONFIG, PRIORITY_CONFIG, COMPLEXITY_CONFIG } from '@/types'
import { cn, formatDate, isOverdue } from '@/lib/utils'
import { AlertCircle, Clock, Zap, FolderOpen, FileText, Layers, CheckSquare, DollarSign, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { StatusChanger } from './StatusChanger'
import { CommentBox } from './CommentBox'
import { AssigneeSelector } from './AssigneeSelector'

function LinkRow({ icon, label, url }: { icon: React.ReactNode; label: string; url: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-2 text-sm group hover:bg-gray-50 rounded-lg -mx-1 px-1 py-1 transition">
      <span className="text-gray-400 shrink-0">{icon}</span>
      <span className="text-gray-500 text-xs w-20 shrink-0">{label}</span>
      <span className="text-indigo-600 text-xs truncate group-hover:underline flex items-center gap-1">
        {url.replace(/^https?:\/\//, '').slice(0, 30)}…
        <ExternalLink className="w-3 h-3 shrink-0" />
      </span>
    </a>
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
    .select('name, workspaces(org_id)')
    .eq('id', campaignId)
    .single()

  // Fetch org members for assignee selector
  const orgId = (campaign?.workspaces as unknown as { org_id: string } | null)?.org_id
  const { data: membersRaw } = orgId ? await supabase
    .from('organization_members')
    .select('user_id, profiles(id, full_name, email, avatar_url)')
    .eq('org_id', orgId) : { data: [] }

  const members = (membersRaw ?? []).map(m => {
    const p = m.profiles as unknown as { id: string; full_name: string | null; email: string; avatar_url: string | null } | null
    return { userId: m.user_id, fullName: p?.full_name ?? null, email: p?.email ?? '', avatarUrl: p?.avatar_url ?? null }
  })

  // Responsáveis da atividade (sem vínculo de status)
  const { data: assigneesRaw } = await supabase
    .from('activity_assignees')
    .select('user_id')
    .eq('activity_id', activityId)

  const assignedIds = (assigneesRaw ?? []).map(a => a.user_id)

  const statusCfg = STATUS_CONFIG.find((s) => s.value === activity.status)!
  const priorityCfg = PRIORITY_CONFIG[activity.priority]
  const complexityCfg = COMPLEXITY_CONFIG[activity.complexity]
  const overdue = isOverdue(activity.due_date)

  const path = `/${orgSlug}/workspaces/${workspaceId}/campaigns/${campaignId}/activities/${activityId}`

  return (
    <div className="p-8 max-w-4xl">

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href={`/${orgSlug}/workspaces`} className="hover:text-gray-600">Clientes</Link>
        <span>/</span>
        <Link href={`/${orgSlug}/workspaces/${workspaceId}`} className="hover:text-gray-600">Cliente</Link>
        <span>/</span>
        <Link href={`/${orgSlug}/workspaces/${workspaceId}/campaigns/${campaignId}`} className="hover:text-gray-600">
          {campaign?.name}
        </Link>
        <span>/</span>
        <span className="text-gray-700 truncate max-w-xs">{activity.title}</span>
      </div>

      <div className="grid grid-cols-3 gap-6">

        {/* Coluna principal */}
        <div className="col-span-2 space-y-6">

          {/* Título + status */}
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 mb-3">{activity.title}</h1>
            {activity.description && (
              <p className="text-gray-600 text-sm leading-relaxed">{activity.description}</p>
            )}
          </div>

          {/* Pipeline de status */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Pipeline de status</p>
            <div className="space-y-1">
              {['internal', 'external', 'done'].map((group) => {
                const groupLabel = group === 'internal' ? 'Trabalho interno' : group === 'external' ? 'Cliente / Fornecedores' : 'Encerrado'
                const items = STATUS_CONFIG.filter((s) => s.group === group)
                return (
                  <div key={group}>
                    <p className="text-xs text-gray-400 mt-3 mb-1.5 font-medium">{groupLabel}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {items.map((s) => (
                        <span
                          key={s.value}
                          className={cn(
                            'px-2.5 py-1 rounded-full text-xs font-medium transition',
                            activity.status === s.value
                              ? `${s.bgColor} ${s.color} ring-2 ring-offset-1 ring-current`
                              : 'bg-gray-100 text-gray-400'
                          )}
                        >
                          {s.label}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Alterar status */}
          <StatusChanger
            activityId={activityId}
            currentStatus={activity.status}
            path={path}
          />

          {/* Comentários */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Comentários</p>
            {comments && comments.length > 0 ? (
              <div className="space-y-4 mb-4">
                {comments.map((c) => {
                  const profile = c.profiles as { full_name: string | null; avatar_url: string | null } | null
                  return (
                    <div key={c.id} className="flex gap-3">
                      <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 text-xs font-medium text-indigo-600">
                        {profile?.full_name?.charAt(0) ?? '?'}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-gray-900">{profile?.full_name ?? 'Usuário'}</span>
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
              <div className="space-y-3">
                {history.map((h) => {
                  const toStatus = STATUS_CONFIG.find((s) => s.value === h.to_status)
                  const fromStatus = STATUS_CONFIG.find((s) => s.value === h.from_status)
                  const profile = h.profiles as unknown as { full_name: string | null } | null
                  return (
                    <div key={h.id} className="flex items-start gap-3 text-sm">
                      <div className="w-1.5 h-1.5 rounded-full bg-gray-300 mt-2 shrink-0" />
                      <div className="flex-1">
                        <span className="text-gray-700">
                          {fromStatus ? (
                            <><span className={cn('font-medium', fromStatus.color)}>{fromStatus.label}</span>{' → '}</>
                          ) : 'Criado em '}
                          <span className={cn('font-medium', toStatus?.color)}>{toStatus?.label}</span>
                        </span>
                        {h.comment && <p className="text-gray-500 mt-0.5 italic">"{h.comment}"</p>}
                        <p className="text-gray-400 text-xs mt-0.5">
                          {profile?.full_name ?? 'Sistema'} · {formatDate(h.changed_at)}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar direita */}
        <div className="space-y-4">

          {/* Status atual */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Status</p>
            <span className={cn('inline-flex px-3 py-1.5 rounded-full text-sm font-medium', statusCfg.bgColor, statusCfg.color)}>
              {statusCfg.label}
            </span>
          </div>

          {/* Responsáveis */}
          <AssigneeSelector
            activityId={activityId}
            assignedIds={assignedIds}
            members={members}
            path={path}
          />

          {/* Prioridade */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Prioridade</p>
            <span className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium', priorityCfg.bgColor, priorityCfg.color)}>
              <Zap className="w-3.5 h-3.5" />
              {priorityCfg.label}
            </span>
          </div>

          {/* Complexidade */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Complexidade</p>
            <span className={cn('text-sm font-medium', complexityCfg.color)}>
              {complexityCfg.label}
            </span>
          </div>

          {/* Prazo */}
          {activity.due_date && (
            <div className={cn('rounded-xl border p-4', overdue ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200')}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Prazo</p>
              <span className={cn('flex items-center gap-1.5 text-sm font-medium', overdue ? 'text-red-600' : 'text-gray-700')}>
                {overdue && <AlertCircle className="w-4 h-4" />}
                <Clock className="w-4 h-4" />
                {formatDate(activity.due_date)}
              </span>
              {overdue && <p className="text-xs text-red-500 mt-1">Atividade atrasada</p>}
            </div>
          )}

          {/* Horas estimadas */}
          {activity.estimated_hours && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Horas estimadas</p>
              <span className="text-sm font-medium text-gray-700">{activity.estimated_hours}h</span>
            </div>
          )}

          {/* Criado em */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Criado em</p>
            <span className="text-sm text-gray-600">{formatDate(activity.created_at)}</span>
          </div>

          {/* Links do Drive */}
          {(activity.drive_folder_url || activity.redacao_url || activity.layout_url || activity.finalizacao_url || activity.orcamento) && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Arquivos</p>

              {activity.drive_folder_url && (
                <LinkRow icon={<FolderOpen className="w-3.5 h-3.5" />} label="Pasta Drive" url={activity.drive_folder_url} />
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
                <div className="flex items-center gap-2 text-sm">
                  <DollarSign className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  <span className="text-gray-500 text-xs w-20 shrink-0">Orçamento</span>
                  <span className="text-gray-700 text-xs truncate">{activity.orcamento}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
