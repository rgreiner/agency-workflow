import { createClient } from '@/lib/supabase/server'
import { STATUS_CONFIG } from '@/types'
import { AlertCircle, CheckCircle2, Clock, TrendingUp, CalendarClock } from 'lucide-react'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { Avatar } from '@/components/ui/Avatar'

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const supabase = await createClient()

  const { data: orgData } = await supabase
    .from('organizations').select('id, name').eq('slug', orgSlug).single()
  if (!orgData) return null

  const { data: workspaces } = await supabase
    .from('workspaces').select('id').eq('org_id', orgData.id).neq('archived', true)
  const wsIds = workspaces?.map(w => w.id) ?? []

  const { data: campaigns } = wsIds.length
    ? await supabase.from('campaigns').select('id, name, workspace_id').in('workspace_id', wsIds)
    : { data: [] }
  const campIds = campaigns?.map(c => c.id) ?? []

  const { data: activities } = campIds.length
    ? await supabase.from('activities')
        .select('id, title, status, due_date, campaign_id')
        .in('campaign_id', campIds)
    : { data: [] }

  // Recent history (last 12 status changes)
  const { data: history } = campIds.length
    ? await supabase.from('activity_history')
        .select('id, to_status, changed_at, comment, activities(id, title, campaign_id), profiles(full_name, avatar_url)')
        .in('activity_id',
          (activities ?? []).slice(0, 200).map(a => a.id)
        )
        .order('changed_at', { ascending: false })
        .limit(12)
    : { data: [] }

  // Stats
  const total = activities?.length ?? 0
  const done = activities?.filter(a => a.status === 'concluido').length ?? 0
  const active = activities?.filter(a => a.status !== 'concluido').length ?? 0

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const weekEnd = new Date(today); weekEnd.setDate(today.getDate() + 7)

  const overdue = activities?.filter(a => {
    if (!a.due_date || a.status === 'concluido') return false
    return new Date(a.due_date) < today
  }).length ?? 0

  const dueThisWeek = activities?.filter(a => {
    if (!a.due_date || a.status === 'concluido') return false
    const d = new Date(a.due_date)
    return d >= today && d <= weekEnd
  }).length ?? 0

  const statusCounts = STATUS_CONFIG.map(s => ({
    ...s,
    count: activities?.filter(a => a.status === s.value).length ?? 0,
  })).filter(s => s.count > 0)

  // Campaign map for history links
  const campMap = Object.fromEntries(
    (campaigns ?? []).map(c => [c.id, { name: c.name, workspaceId: c.workspace_id }])
  )

  const cards = [
    { label: 'Em andamento',      value: active,      icon: Clock,         color: 'text-blue-600',   bg: 'bg-blue-50'   },
    { label: 'Atrasadas',         value: overdue,     icon: AlertCircle,   color: 'text-red-600',    bg: 'bg-red-50'    },
    { label: 'Vencem esta semana',value: dueThisWeek, icon: CalendarClock, color: 'text-orange-600', bg: 'bg-orange-50' },
    { label: 'Concluídas',        value: done,        icon: CheckCircle2,  color: 'text-green-600',  bg: 'bg-green-50'  },
  ]

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-0.5">{total} atividade{total !== 1 ? 's' : ''} no total</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-4 mb-5">
        {cards.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className={cn('inline-flex p-2 rounded-lg mb-3', bg)}>
              <Icon className={cn('w-5 h-5', color)} />
            </div>
            <div className="text-3xl font-bold text-gray-900">{value}</div>
            <div className="text-sm text-gray-500 mt-1">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Status breakdown */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Atividades por status</h2>
          <div className="space-y-2.5">
            {statusCounts.map(({ value, label, bgColor, color, count }) => (
              <div key={value} className="flex items-center gap-3">
                <span className={cn('px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0 w-48 truncate', bgColor, color)}>
                  {label}
                </span>
                <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                  <div
                    className="bg-indigo-500 h-1.5 rounded-full transition-all"
                    style={{ width: total > 0 ? `${(count / total) * 100}%` : '0%' }}
                  />
                </div>
                <span className="text-sm font-medium text-gray-600 w-5 text-right shrink-0">{count}</span>
              </div>
            ))}
            {statusCounts.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">
                Nenhuma atividade ainda.
              </p>
            )}
          </div>
        </div>

        {/* Recent history */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Últimas movimentações</h2>
          <div className="space-y-3">
            {(history ?? []).map((h) => {
              const activity = h.activities as unknown as { id: string; title: string; campaign_id: string } | null
              const profile = h.profiles as unknown as { full_name: string | null; avatar_url: string | null } | null
              const statusCfg = STATUS_CONFIG.find(s => s.value === h.to_status)
              const camp = activity ? campMap[activity.campaign_id] : null

              return (
                <div key={h.id} className="flex items-start gap-2.5">
                  <Avatar
                    name={profile?.full_name ?? '?'}
                    avatarUrl={profile?.avatar_url}
                    size="sm"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-medium text-gray-700 truncate">
                        {profile?.full_name ?? 'Alguém'}
                      </span>
                      <span className="text-xs text-gray-400">moveu para</span>
                      {statusCfg && (
                        <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded-full', statusCfg.bgColor, statusCfg.color)}>
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
              <p className="text-sm text-gray-400 text-center py-8">
                Nenhuma movimentação ainda.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
