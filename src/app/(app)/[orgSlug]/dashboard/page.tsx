import { createClient } from '@/lib/supabase/server'
import { STATUS_CONFIG } from '@/types'
import { AlertCircle, CheckCircle2, Clock, TrendingUp } from 'lucide-react'

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const supabase = await createClient()

  const { data: orgData } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('slug', orgSlug)
    .single()

  if (!orgData) return null
  const org: { id: string; name: string } = orgData

  // Fetch workspace IDs for this org, then campaign IDs, then activities
  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id')
    .eq('org_id', org.id)
    .eq('archived', false)

  const workspaceIds = workspaces?.map((w) => w.id) ?? []

  const { data: campaigns } = workspaceIds.length
    ? await supabase.from('campaigns').select('id').in('workspace_id', workspaceIds)
    : { data: [] }

  const campaignIds = campaigns?.map((c) => c.id) ?? []

  const { data: activities } = campaignIds.length
    ? await supabase.from('activities').select('status, due_date').in('campaign_id', campaignIds)
    : { data: [] }

  const total = activities?.length ?? 0
  const done = activities?.filter((a) => a.status === 'concluido').length ?? 0
  const overdue = activities?.filter((a) => {
    if (!a.due_date || a.status === 'concluido') return false
    return new Date(a.due_date) < new Date()
  }).length ?? 0

  const inProgress = activities?.filter((a) =>
    a.status !== 'concluido' && a.status !== 'briefing'
  ).length ?? 0

  const statusCounts = STATUS_CONFIG.map((s) => ({
    ...s,
    count: activities?.filter((a) => a.status === s.value).length ?? 0,
  })).filter((s) => s.count > 0)

  const cards = [
    { label: 'Total de atividades', value: total, icon: TrendingUp, color: 'text-indigo-600', bg: 'bg-indigo-50' },
    { label: 'Em andamento', value: inProgress, icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Atrasadas', value: overdue, icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50' },
    { label: 'Concluídas', value: done, icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50' },
  ]

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">{org.name}</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {cards.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className={`inline-flex p-2 rounded-lg ${bg} mb-3`}>
              <Icon className={`w-5 h-5 ${color}`} />
            </div>
            <div className="text-3xl font-semibold text-gray-900">{value}</div>
            <div className="text-sm text-gray-500 mt-1">{label}</div>
          </div>
        ))}
      </div>

      {/* Status breakdown */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Atividades por status</h2>
        <div className="space-y-2">
          {statusCounts.map(({ value, label, bgColor, color, count }) => (
            <div key={value} className="flex items-center gap-3">
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${bgColor} ${color} w-52 shrink-0`}>
                {label}
              </span>
              <div className="flex-1 bg-gray-100 rounded-full h-2">
                <div
                  className="bg-indigo-500 h-2 rounded-full"
                  style={{ width: total > 0 ? `${(count / total) * 100}%` : '0%' }}
                />
              </div>
              <span className="text-sm text-gray-600 w-6 text-right">{count}</span>
            </div>
          ))}
          {statusCounts.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">
              Nenhuma atividade ainda. Crie um cliente para começar.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
