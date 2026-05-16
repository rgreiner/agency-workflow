import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Plus, ArrowLeft, AlertCircle } from 'lucide-react'
import { STATUS_CONFIG, PRIORITY_CONFIG } from '@/types'
import { formatDate, isOverdue, daysUntil } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { AvatarGroup } from '@/components/ui/Avatar'

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ orgSlug: string; workspaceId: string; campaignId: string }>
}) {
  const { orgSlug, workspaceId, campaignId } = await params
  const supabase = await createClient()

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('*, workspaces(name)')
    .eq('id', campaignId)
    .single()

  if (!campaign) return null

  const { data: activities } = await supabase
    .from('activities')
    .select('*, activity_assignees(user_id, profiles(full_name, avatar_url))')
    .eq('campaign_id', campaignId)
    .order('sort_order', { ascending: true })

  const grouped = STATUS_CONFIG.reduce((acc, s) => {
    acc[s.value] = activities?.filter((a) => a.status === s.value) ?? []
    return acc
  }, {} as Record<string, typeof activities>)

  return (
    <div className="p-8">
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
        <Link href={`/${orgSlug}/workspaces`} className="hover:text-gray-700 transition">Clientes</Link>
        <span>/</span>
        <Link href={`/${orgSlug}/workspaces/${workspaceId}`} className="hover:text-gray-700 transition">
          {(campaign.workspaces as { name: string })?.name}
        </Link>
        <span>/</span>
        <span className="text-gray-900">{campaign.name}</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link
            href={`/${orgSlug}/workspaces/${workspaceId}`}
            className="text-gray-400 hover:text-gray-600 transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <h1 className="text-2xl font-semibold text-gray-900">{campaign.name}</h1>
        </div>
        <Link
          href={`/${orgSlug}/workspaces/${workspaceId}/campaigns/${campaignId}/activities/new`}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition"
        >
          <Plus className="w-4 h-4" />
          Nova atividade
        </Link>
      </div>

      {/* Activity list grouped by status */}
      <div className="space-y-2">
        {STATUS_CONFIG.map((statusCfg) => {
          const items = grouped[statusCfg.value] ?? []
          if (items.length === 0) return null
          return (
            <div key={statusCfg.value} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className={`px-4 py-2.5 border-b border-gray-100 flex items-center gap-2`}>
                <span className={cn('text-xs font-medium px-2.5 py-0.5 rounded-full', statusCfg.bgColor, statusCfg.color)}>
                  {statusCfg.label}
                </span>
                <span className="text-xs text-gray-400">{items.length}</span>
              </div>
              <div className="divide-y divide-gray-50">
                {items.map((activity) => {
                  const overdue = isOverdue(activity.due_date)
                  const days = daysUntil(activity.due_date)
                  const priority = PRIORITY_CONFIG[activity.priority]
                  return (
                    <Link
                      key={activity.id}
                      href={`/${orgSlug}/workspaces/${workspaceId}/campaigns/${campaignId}/activities/${activity.id}`}
                      className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition"
                    >
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-gray-900">{activity.title}</span>
                      </div>
                      {/* Responsáveis */}
                      {(() => {
                        const assignees = (activity.activity_assignees as unknown as { profiles: { full_name: string | null; avatar_url: string | null } }[])?.map(a => a.profiles) ?? []
                        return assignees.length > 0
                          ? <AvatarGroup users={assignees} />
                          : <span className="text-xs text-gray-300 w-10">—</span>
                      })()}
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

        {(activities?.length ?? 0) === 0 && (
          <div className="text-center py-20 bg-white rounded-xl border border-gray-200">
            <p className="text-gray-900 font-medium">Nenhuma atividade ainda</p>
            <p className="text-gray-500 text-sm mt-1">Crie a primeira atividade desta campanha</p>
          </div>
        )}
      </div>
    </div>
  )
}
