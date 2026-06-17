import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { getMergedStatusConfig, type StatusOverride } from '@/types'
import {
  AlertCircle, CheckCircle2, Clock, CalendarClock,
  CalendarDays, AlertTriangle, ChevronRight,
} from 'lucide-react'
import { cn, formatDate } from '@/lib/utils'
import Link from 'next/link'
import { Avatar } from '@/components/ui/Avatar'
import { WeeklyProgress } from '@/components/dashboard/WeeklyProgress'

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const supabase = await createClient()

  const user = await getUsuario()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles').select('full_name').eq('id', user.id).single()

  const { data: orgData } = await supabase
    .from('organizations').select('id, name').eq('slug', orgSlug).single()
  if (!orgData) return null

  // Cores de status definidas em Configurações → Aparência (mescladas).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawSettings } = await (supabase as any)
    .from('org_settings').select('status_overrides').eq('org_id', orgData.id).single()
  const statusConfig = getMergedStatusConfig((rawSettings?.status_overrides ?? []) as StatusOverride[])

  // ── My assigned activity IDs ───────────────────────────────────────────────
  const { data: myAssignments } = await supabase
    .from('activity_status_assignees')
    .select('activity_id, status')
    .eq('user_id', user.id)

  const myActivityIds = [...new Set((myAssignments ?? []).map(a => a.activity_id))]

  // Map: activityId → statuses I'm assigned to
  const myStatusMap = (myAssignments ?? []).reduce<Record<string, string[]>>((acc, a) => {
    if (!acc[a.activity_id]) acc[a.activity_id] = []
    acc[a.activity_id].push(a.status)
    return acc
  }, {})

  // ── My active tasks (I'm responsible for the CURRENT status) ──────────────
  const { data: myActivitiesRaw } = myActivityIds.length
    ? await supabase
        .from('activities')
        .select('id, title, status, due_date, campaign_id, campaigns(id, name, workspace_id, workspaces(id, name))')
        .in('id', myActivityIds)
        .eq('archived', false)
        .neq('status', 'concluido')
    : { data: [] }

  // Keep only where current status is one I'm assigned to
  const myActive = (myActivitiesRaw ?? []).filter(a =>
    myStatusMap[a.id]?.includes(a.status)
  )

  // ── Completions this week (activities I was assigned to) ──────────────────
  const monday = new Date()
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  monday.setHours(0, 0, 0, 0)

  const { data: doneHistory } = myActivityIds.length
    ? await supabase
        .from('activity_history')
        .select('activity_id')
        .eq('to_status', 'concluido')
        .gte('changed_at', monday.toISOString())
        .in('activity_id', myActivityIds)
    : { data: [] }

  const doneThisWeek = new Set((doneHistory ?? []).map(h => h.activity_id)).size

  // ── Date buckets ──────────────────────────────────────────────────────────
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999)
  const weekEnd = new Date(now); weekEnd.setDate(now.getDate() + 7)

  const overdueTasks = myActive.filter(a => a.due_date && new Date(a.due_date) < now)
  const todayTasks = myActive.filter(a => {
    if (!a.due_date) return false
    const d = new Date(a.due_date)
    return d >= now && d <= todayEnd
  })
  const weekTasks = myActive.filter(a => {
    if (!a.due_date) return false
    const d = new Date(a.due_date)
    return d > todayEnd && d <= weekEnd
  })
  const laterTasks = myActive.filter(a => {
    if (!a.due_date) return true
    return new Date(a.due_date) > weekEnd
  })

  const totalWeek = doneThisWeek + myActive.filter(a => {
    if (!a.due_date) return false
    return new Date(a.due_date) <= weekEnd
  }).length

  // ── Org-level stats (team view) ────────────────────────────────────────────
  const { data: workspaces } = await supabase
    .from('workspaces').select('id').eq('org_id', orgData.id).neq('archived', true)
  const wsIds = workspaces?.map(w => w.id) ?? []

  const { data: campaigns } = wsIds.length
    ? await supabase.from('campaigns').select('id, name, workspace_id').in('workspace_id', wsIds)
    : { data: [] }
  const campIds = campaigns?.map(c => c.id) ?? []

  const { data: allActivities } = campIds.length
    ? await supabase.from('activities').select('id, status, due_date').in('campaign_id', campIds).eq('archived', false)
    : { data: [] }

  const total = allActivities?.length ?? 0
  const done = allActivities?.filter(a => a.status === 'concluido').length ?? 0
  const active = total - done

  const orgOverdue = allActivities?.filter(a =>
    a.due_date && a.status !== 'concluido' && new Date(a.due_date) < now
  ).length ?? 0

  const orgDueWeek = allActivities?.filter(a => {
    if (!a.due_date || a.status === 'concluido') return false
    const d = new Date(a.due_date)
    return d >= now && d <= weekEnd
  }).length ?? 0

  const statusCounts = statusConfig.map(s => ({
    ...s,
    count: allActivities?.filter(a => a.status === s.value).length ?? 0,
  })).filter(s => s.count > 0)

  const campMap = Object.fromEntries(
    (campaigns ?? []).map(c => [c.id, { name: c.name, workspaceId: c.workspace_id }])
  )

  const { data: history } = campIds.length
    ? await supabase.from('activity_history')
        .select('id, to_status, changed_at, activities(id, title, campaign_id), profiles(full_name, avatar_url)')
        .in('activity_id', (allActivities ?? []).slice(0, 200).map(a => a.id))
        .order('changed_at', { ascending: false })
        .limit(10)
    : { data: [] }

  const userName = profile?.full_name ?? user.email ?? 'você'

  return (
    <div className="p-6">

      {/* ── Personal hero ─────────────────────────────────────────────────── */}
      <WeeklyProgress
        done={doneThisWeek}
        total={Math.max(totalWeek, doneThisWeek)}
        overdue={overdueTasks.length}
        myActiveCount={myActive.length}
        userName={userName}
      />

      {/* ── My personal KPIs ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        {[
          { label: 'Minhas ativas',      value: myActive.length,   icon: Clock,          color: 'text-blue-600',   bg: 'bg-blue-50'   },
          { label: 'Atrasadas',          value: overdueTasks.length, icon: AlertCircle,  color: 'text-red-600',    bg: 'bg-red-50'    },
          { label: 'Vencem hoje',        value: todayTasks.length, icon: AlertTriangle,  color: 'text-orange-600', bg: 'bg-orange-50' },
          { label: 'Vencem essa semana', value: weekTasks.length,  icon: CalendarClock,  color: 'text-yellow-600', bg: 'bg-yellow-50' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className={cn('inline-flex p-2 rounded-lg mb-3', bg)}>
              <Icon className={cn('w-5 h-5', color)} />
            </div>
            <div className="text-3xl font-bold text-gray-900">{value}</div>
            <div className="text-sm text-gray-500 mt-1">{label}</div>
          </div>
        ))}
      </div>

      {/* ── My task list ──────────────────────────────────────────────────── */}
      {myActive.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Minhas tarefas</h2>
          <div className="space-y-1">
            {[
              { tasks: overdueTasks, label: 'Atrasadas',    dot: 'bg-red-500',    badge: 'bg-red-50 text-red-600'       },
              { tasks: todayTasks,   label: 'Vencem hoje',  dot: 'bg-orange-400', badge: 'bg-orange-50 text-orange-600' },
              { tasks: weekTasks,    label: 'Esta semana',  dot: 'bg-yellow-400', badge: 'bg-yellow-50 text-yellow-600' },
              { tasks: laterTasks,   label: 'Mais adiante', dot: 'bg-gray-300',   badge: 'bg-gray-50 text-gray-500'     },
            ].map(({ tasks, label, dot, badge }) =>
              tasks.length > 0 && (
                <div key={label}>
                  <div className="flex items-center gap-2 px-2 py-1.5 mb-1">
                    <span className={cn('w-2 h-2 rounded-full shrink-0', dot)} />
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</span>
                  </div>
                  {tasks.map(task => {
                    const camp = campMap[task.campaign_id]
                    const ws = (task.campaigns as unknown as { workspaces: { id: string; name: string } | null } | null)?.workspaces
                    const wsId = ws?.id ?? camp?.workspaceId
                    const statusCfg = statusConfig.find(s => s.value === task.status)
                    return (
                      <Link
                        key={task.id}
                        href={`/${orgSlug}/workspaces/${wsId}/campaigns/${task.campaign_id}/activities/${task.id}`}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 transition group"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{task.title}</p>
                          <p className="text-xs text-gray-400 truncate mt-0.5">
                            {ws?.name ?? camp?.name} {camp ? `· ${camp.name}` : ''}
                          </p>
                        </div>
                        {statusCfg && (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full shrink-0"
                            style={{ backgroundColor: statusCfg.bg, color: statusCfg.text }}>
                            {statusCfg.label}
                          </span>
                        )}
                        {task.due_date && (
                          <span className={cn('text-xs font-medium shrink-0 px-2 py-0.5 rounded-full', badge)}>
                            {formatDate(task.due_date)}
                          </span>
                        )}
                        <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500 shrink-0 transition" />
                      </Link>
                    )
                  })}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* ── Team view ─────────────────────────────────────────────────────── */}
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Visão do time</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        {[
          { label: 'Em andamento',       value: active,     icon: Clock,        color: 'text-blue-600',   bg: 'bg-blue-50'   },
          { label: 'Atrasadas',          value: orgOverdue, icon: AlertCircle,  color: 'text-red-600',    bg: 'bg-red-50'    },
          { label: 'Vencem essa semana', value: orgDueWeek, icon: CalendarDays, color: 'text-orange-600', bg: 'bg-orange-50' },
          { label: 'Concluídas',         value: done,       icon: CheckCircle2, color: 'text-green-600',  bg: 'bg-green-50'  },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className={cn('inline-flex p-2 rounded-lg mb-3', bg)}>
              <Icon className={cn('w-5 h-5', color)} />
            </div>
            <div className="text-3xl font-bold text-gray-900">{value}</div>
            <div className="text-sm text-gray-500 mt-1">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Status breakdown */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Atividades por status</h2>
          <div className="space-y-2.5">
            {statusCounts.map(({ value, label, bg, text, count }) => (
              <div key={value} className="flex items-center gap-3">
                <span
                  className="px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0 w-48 truncate"
                  style={{ backgroundColor: bg, color: text }}
                >
                  {label}
                </span>
                <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                  <div
                    className="h-1.5 rounded-full"
                    style={{ width: total > 0 ? `${(count / total) * 100}%` : '0%', backgroundColor: text }}
                  />
                </div>
                <span className="text-sm font-medium text-gray-600 w-5 text-right shrink-0">{count}</span>
              </div>
            ))}
            {statusCounts.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">Nenhuma atividade ainda.</p>
            )}
          </div>
        </div>

        {/* Recent history */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Últimas movimentações</h2>
          <div className="space-y-3">
            {(history ?? []).map((h) => {
              const activity = h.activities as unknown as { id: string; title: string; campaign_id: string } | null
              const prof = h.profiles as unknown as { full_name: string | null; avatar_url: string | null } | null
              const statusCfg = statusConfig.find(s => s.value === h.to_status)
              const camp = activity ? campMap[activity.campaign_id] : null
              return (
                <div key={h.id} className="flex items-start gap-2.5">
                  <Avatar name={prof?.full_name ?? '?'} avatarUrl={prof?.avatar_url} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-medium text-gray-700 truncate">{prof?.full_name ?? 'Alguém'}</span>
                      <span className="text-xs text-gray-400">moveu para</span>
                      {statusCfg && (
                        <span className="text-xs font-medium px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: statusCfg.bg, color: statusCfg.text }}>
                          {statusCfg.label}
                        </span>
                      )}
                    </div>
                    {activity && camp && (
                      <Link
                        href={`/${orgSlug}/workspaces/${camp.workspaceId}/campaigns/${activity.campaign_id}/activities/${activity.id}`}
                        className="text-xs text-gray-500 hover:text-indigo-600 transition truncate block mt-0.5"
                      >
                        {activity.title}
                      </Link>
                    )}
                  </div>
                  <span className="text-[10px] text-gray-400 shrink-0 mt-0.5">
                    {new Date(h.changed_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                  </span>
                </div>
              )
            })}
            {(history?.length ?? 0) === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">Nenhuma movimentação ainda.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
