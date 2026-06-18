import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Plus, AlertCircle } from 'lucide-react'
import { STATUS_CONFIG, PRIORITY_CONFIG } from '@/types'
import { isOverdue, daysUntil } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { AvatarGroup } from '@/components/ui/Avatar'
import { CampaignEditButton } from './CampaignEditButton'

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
    .eq('archived', false)
    .order('sort_order', { ascending: true })

  const grouped = STATUS_CONFIG.reduce((acc, s) => {
    acc[s.value] = activities?.filter((a) => a.status === s.value) ?? []
    return acc
  }, {} as Record<string, typeof activities>)

  const activeGroups = STATUS_CONFIG.filter(s => (grouped[s.value]?.length ?? 0) > 0)
  const wsName = (campaign.workspaces as { name: string })?.name

  return (
    <div className="p-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
        <Link href={`/${orgSlug}/views/lista`} className="hover:text-gray-600 transition">Clientes</Link>
        <span>/</span>
        <Link href={`/${orgSlug}/workspaces/${workspaceId}`} className="hover:text-gray-600 transition">{wsName}</Link>
        <span>/</span>
        <span className="text-gray-600">{campaign.name}</span>
      </div>

      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-gray-900">{campaign.name}</h1>
          <CampaignEditButton
            orgSlug={orgSlug}
            workspaceId={workspaceId}
            campaignId={campaignId}
            name={campaign.name}
            description={campaign.description ?? ''}
            startDate={campaign.start_date ?? ''}
            endDate={campaign.end_date ?? ''}
            archived={campaign.archived ?? false}
          />
        </div>
        <Link
          href={`/${orgSlug}/workspaces/${workspaceId}/campaigns/${campaignId}/activities/new`}
          className="inline-flex items-center gap-2 px-3 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition"
        >
          <Plus className="w-4 h-4" />
          Nova atividade
        </Link>
      </div>

      {/* Activity list — single card, groups separated by internal dividers */}
      {activeGroups.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-gray-200">
          <p className="text-gray-900 font-medium">Nenhuma atividade ainda</p>
          <p className="text-gray-500 text-sm mt-1">Crie a primeira atividade desta campanha</p>
          <Link
            href={`/${orgSlug}/workspaces/${workspaceId}/campaigns/${campaignId}/activities/new`}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition"
          >
            <Plus className="w-4 h-4" /> Nova atividade
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {activeGroups.map((statusCfg) => {
            const items = grouped[statusCfg.value] ?? []
            return (
              <div key={statusCfg.value} className="border-b border-gray-100 last:border-0">
                {/* Group header */}
                <div className="flex items-center gap-2 px-4 py-2 bg-gray-50/70 border-b border-gray-100">
                  <span className={cn('text-xs font-semibold px-2.5 py-0.5 rounded-full', statusCfg.bgColor, statusCfg.color)}>
                    {statusCfg.label}
                  </span>
                  <span className="text-xs text-gray-400">{items.length}</span>
                </div>

                {/* Activity rows */}
                <div className="divide-y divide-gray-50">
                  {items.map((activity) => {
                    const overdue = isOverdue(activity.due_date)
                    const days = daysUntil(activity.due_date)
                    const priority = PRIORITY_CONFIG[activity.priority]
                    const assignees = (activity.activity_assignees as unknown as { profiles: { full_name: string | null; avatar_url: string | null } }[])?.map(a => a.profiles) ?? []
                    return (
                      <Link
                        key={activity.id}
                        href={`/${orgSlug}/workspaces/${workspaceId}/campaigns/${campaignId}/activities/${activity.id}`}
                        className="flex items-center gap-4 px-4 py-2.5 hover:bg-gray-50 transition"
                      >
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-gray-900 truncate block">{activity.title}</span>
                        </div>

                        {assignees.length > 0
                          ? <AvatarGroup users={assignees} />
                          : <span className="text-xs text-gray-300 w-10 shrink-0">—</span>
                        }

                        {activity.priority !== 'medium' && (
                          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium shrink-0', priority.bgColor, priority.color)}>
                            {priority.label}
                          </span>
                        )}

                        {activity.due_date && (
                          <span className={cn('flex items-center gap-1 text-xs shrink-0 font-medium', overdue ? 'text-red-600' : days !== null && days <= 3 ? 'text-orange-500' : 'text-gray-500')}>
                            {overdue && <AlertCircle className="w-3 h-3" />}
                            {overdue ? `${Math.abs(days!)}d atraso` : days === 0 ? 'Hoje' : days === 1 ? 'Amanhã' : `${days}d`}
                          </span>
                        )}
                      </Link>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
