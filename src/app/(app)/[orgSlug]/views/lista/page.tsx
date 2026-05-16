import { createClient } from '@/lib/supabase/server'
import { STATUS_CONFIG, PRIORITY_CONFIG } from '@/types'
import { cn, isOverdue, daysUntil } from '@/lib/utils'
import { AlertCircle, ExternalLink, ChevronDown } from 'lucide-react'
import Link from 'next/link'
import { AvatarGroup } from '@/components/ui/Avatar'

export default async function ListaPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const supabase = await createClient()

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return null

  const { data: workspaces } = await supabase
    .from('workspaces').select('id').eq('org_id', org.id).eq('archived', false)
  const wsIds = workspaces?.map(w => w.id) ?? []

  const { data: campaigns } = wsIds.length
    ? await supabase.from('campaigns').select('id, name, workspace_id, workspaces(name)').in('workspace_id', wsIds)
    : { data: [] }
  const campIds = campaigns?.map(c => c.id) ?? []

  const { data: activities } = campIds.length
    ? await supabase.from('activities')
        .select('id, title, status, priority, due_date, layout_url, campaign_id, activity_assignees(profiles(full_name, avatar_url))')
        .in('campaign_id', campIds)
        .neq('status', 'concluido')
        .order('due_date', { ascending: true, nullsFirst: false })
    : { data: [] }

  // Map campaign info
  const campMap = Object.fromEntries(
    (campaigns ?? []).map(c => [c.id, {
      name: c.name,
      client: (c.workspaces as unknown as { name: string })?.name ?? '',
      workspaceId: c.workspace_id,
    }])
  )

  // Group by status
  const grouped = STATUS_CONFIG.reduce((acc, s) => {
    const items = (activities ?? []).filter(a => a.status === s.value)
    if (items.length > 0) acc[s.value] = items
    return acc
  }, {} as Record<string, typeof activities>)

  const totalCount = activities?.length ?? 0

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Lista de atividades</h1>
          <p className="text-gray-500 text-sm mt-0.5">{totalCount} atividade{totalCount !== 1 ? 's' : ''} em andamento</p>
        </div>
      </div>

      <div className="space-y-2">
        {STATUS_CONFIG.filter(s => grouped[s.value]?.length).map((statusCfg) => {
          const items = grouped[statusCfg.value] ?? []
          return (
            <details key={statusCfg.value} open className="group bg-white rounded-xl border border-gray-200 overflow-hidden">
              <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none hover:bg-gray-50 transition list-none">
                <ChevronDown className="w-4 h-4 text-gray-400 group-open:rotate-0 -rotate-90 transition-transform" />
                <span className={cn('px-2.5 py-0.5 rounded-full text-xs font-semibold', statusCfg.bgColor, statusCfg.color)}>
                  {statusCfg.label}
                </span>
                <span className="text-sm text-gray-400">{items.length}</span>
              </summary>

              <table className="w-full text-sm">
                <thead>
                  <tr className="border-t border-gray-100 bg-gray-50/50">
                    <th className="text-left px-4 py-2 text-xs font-medium text-gray-400 w-full">Nome</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-gray-400 whitespace-nowrap">Responsável</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-gray-400 whitespace-nowrap">Prazo</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-gray-400 whitespace-nowrap">Prioridade</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-gray-400 whitespace-nowrap">Layout</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.map((activity) => {
                    const camp = campMap[activity.campaign_id]
                    const overdue = isOverdue(activity.due_date)
                    const days = daysUntil(activity.due_date)
                    const priority = PRIORITY_CONFIG[activity.priority]
                    const assignees = (activity.activity_assignees as unknown as { profiles: { full_name: string | null; avatar_url: string | null } }[])
                      ?.map(a => a.profiles) ?? []

                    return (
                      <tr key={activity.id} className="hover:bg-gray-50/70 transition">
                        <td className="px-4 py-2.5">
                          <Link href={`/${orgSlug}/workspaces/${camp?.workspaceId}/campaigns/${activity.campaign_id}/activities/${activity.id}`}
                            className="block group/link">
                            {camp && (
                              <span className="text-xs text-gray-400 block mb-0.5">
                                {camp.client} / {camp.name}
                              </span>
                            )}
                            <span className="text-gray-900 font-medium group-hover/link:text-indigo-600 transition">
                              {activity.title}
                            </span>
                          </Link>
                        </td>
                        <td className="px-4 py-2.5">
                          {assignees.length > 0
                            ? <AvatarGroup users={assignees} />
                            : <span className="text-xs text-gray-300">—</span>
                          }
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          {activity.due_date ? (
                            <span className={cn('flex items-center gap-1 text-xs font-medium', overdue ? 'text-red-600' : days !== null && days <= 3 ? 'text-orange-500' : 'text-gray-600')}>
                              {overdue && <AlertCircle className="w-3 h-3" />}
                              {overdue ? `${Math.abs(days!)}d atraso` : days === 0 ? 'Hoje' : days === 1 ? 'Amanhã' : `${days}d`}
                            </span>
                          ) : <span className="text-xs text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          {activity.priority !== 'medium' ? (
                            <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', priority.bgColor, priority.color)}>
                              {priority.label}
                            </span>
                          ) : <span className="text-xs text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          {activity.layout_url ? (
                            <a href={activity.layout_url} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 hover:underline">
                              <ExternalLink className="w-3 h-3" /> Layout
                            </a>
                          ) : <span className="text-xs text-gray-300">—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </details>
          )
        })}

        {totalCount === 0 && (
          <div className="text-center py-24 bg-white rounded-xl border border-gray-200">
            <p className="text-gray-900 font-medium">Nenhuma atividade em andamento</p>
            <p className="text-gray-500 text-sm mt-1">Todas as atividades estão concluídas ou ainda não foram criadas.</p>
          </div>
        )}
      </div>
    </div>
  )
}
