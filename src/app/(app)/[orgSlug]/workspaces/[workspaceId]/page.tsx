import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Plus, AlertCircle } from 'lucide-react'
import { STATUS_CONFIG, PRIORITY_CONFIG, type ActivityPriority } from '@/types'
import { cn, isOverdue, daysUntil } from '@/lib/utils'

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ orgSlug: string; workspaceId: string }>
}) {
  const { orgSlug, workspaceId } = await params
  const supabase = await createClient()

  const { data: workspace } = await supabase
    .from('workspaces').select('id, name, color').eq('id', workspaceId).single()
  if (!workspace) return null

  const { data: campaigns } = await supabase
    .from('campaigns').select('id, name').eq('workspace_id', workspaceId)
  const campIds = campaigns?.map(c => c.id) ?? []
  const campMap = Object.fromEntries((campaigns ?? []).map(c => [c.id, c.name]))

  const { data: activities } = campIds.length
    ? await supabase.from('activities')
        .select('id, title, status, priority, due_date, campaign_id')
        .in('campaign_id', campIds)
        .order('sort_order', { ascending: true })
    : { data: [] }

  const total = activities?.length ?? 0
  const active = activities?.filter(a => a.status !== 'concluido').length ?? 0

  const grouped = STATUS_CONFIG.reduce((acc, s) => {
    acc[s.value] = activities?.filter(a => a.status === s.value) ?? []
    return acc
  }, {} as Record<string, typeof activities>)

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-400 mb-1">
            <Link href={`/${orgSlug}/views/lista`} className="hover:text-gray-600 transition">
              Todos os clientes
            </Link>
            <span>/</span>
            <span className="text-gray-700 font-medium">{workspace.name}</span>
          </div>
          <p className="text-sm text-gray-500">
            {active} atividade{active !== 1 ? 's' : ''} em andamento
            {campaigns && campaigns.length > 0 && (
              <span className="ml-2 text-gray-400">
                · {campaigns.length} campanha{campaigns.length !== 1 ? 's' : ''}
              </span>
            )}
          </p>
        </div>
        <Link
          href={`/${orgSlug}/workspaces/${workspaceId}/campaigns/new`}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition"
        >
          <Plus className="w-4 h-4" />
          Nova campanha
        </Link>
      </div>

      {/* Activities grouped by status */}
      <div className="space-y-2">
        {STATUS_CONFIG.map(statusCfg => {
          const items = grouped[statusCfg.value] ?? []
          if (items.length === 0) return null
          return (
            <div key={statusCfg.value} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
                <span className={cn('text-xs font-medium px-2.5 py-0.5 rounded-full', statusCfg.bgColor, statusCfg.color)}>
                  {statusCfg.label}
                </span>
                <span className="text-xs text-gray-400">{items.length}</span>
              </div>
              <div className="divide-y divide-gray-50">
                {items.map(activity => {
                  const overdue = isOverdue(activity.due_date)
                  const days = daysUntil(activity.due_date)
                  const priority = PRIORITY_CONFIG[activity.priority as ActivityPriority]
                  return (
                    <Link
                      key={activity.id}
                      href={`/${orgSlug}/workspaces/${workspaceId}/campaigns/${activity.campaign_id}/activities/${activity.id}`}
                      className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition"
                    >
                      <div className="flex-1 min-w-0">
                        {campaigns && campaigns.length > 1 && (
                          <span className="text-xs text-gray-400 block mb-0.5">
                            {campMap[activity.campaign_id]}
                          </span>
                        )}
                        <span className="text-sm font-medium text-gray-900">{activity.title}</span>
                      </div>
                      {activity.priority !== 'medium' && (
                        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium shrink-0', priority.bgColor, priority.color)}>
                          {priority.label}
                        </span>
                      )}
                      {activity.due_date && (
                        <span className={cn('flex items-center gap-1 text-xs shrink-0', overdue ? 'text-red-600' : 'text-gray-500')}>
                          {overdue && <AlertCircle className="w-3 h-3" />}
                          {overdue ? `${Math.abs(days!)}d atraso` : days === 0 ? 'Hoje' : `${days}d`}
                        </span>
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          )
        })}

        {total === 0 && (
          <div className="text-center py-20 bg-white rounded-xl border border-gray-200">
            <p className="text-gray-900 font-medium">Nenhuma atividade ainda</p>
            <p className="text-gray-500 text-sm mt-1">
              {campaigns?.length === 0
                ? 'Crie a primeira campanha deste cliente'
                : 'Crie atividades nas campanhas deste cliente'}
            </p>
            {campaigns?.length === 0 && (
              <Link
                href={`/${orgSlug}/workspaces/${workspaceId}/campaigns/new`}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition"
              >
                <Plus className="w-4 h-4" /> Nova campanha
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
