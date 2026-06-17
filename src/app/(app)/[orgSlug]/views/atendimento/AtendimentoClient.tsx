'use client'

import { useState } from 'react'
import { STATUS_CONFIG, PRIORITY_CONFIG } from '@/types'
import { cn, isOverdue, daysUntil } from '@/lib/utils'
import { AlertCircle, ExternalLink, ChevronDown, Settings2 } from 'lucide-react'
import Link from 'next/link'
import { AvatarGroup } from '@/components/ui/Avatar'

export type Activity = {
  id: string
  title: string
  status: string
  priority: string
  due_date: string | null
  layout_url: string | null
  campaign_id: string
  updated_at: string
  activity_assignees: unknown[]
  activity_comments: unknown[]
}

type CampMap = Record<string, { name: string; client: string; workspaceId: string }>

// Status que atendimento monitora por padrão
const DEFAULT_MONITORED = [
  'revisao_interna', 'validacao_atendimento', 'aprovacao_cliente',
  'producao_fornecedores', 'producao_audiovisual', 'implantacao_digital', 'implantacao_off',
]

const ALL_COLUMNS = [
  { key: 'responsavel', label: 'Responsável' },
  { key: 'ultimo_comentario', label: 'Último comentário' },
  { key: 'prazo', label: 'Prazo' },
  { key: 'prioridade', label: 'Prioridade' },
  { key: 'layout', label: 'Layout' },
]

export function AtendimentoClient({ activities, campMap, orgSlug }: {
  activities: Activity[]
  campMap: CampMap
  orgSlug: string
}) {
  const [monitoredStatuses, setMonitoredStatuses] = useState<string[]>(DEFAULT_MONITORED)
  const [visibleColumns, setVisibleColumns] = useState<string[]>(ALL_COLUMNS.map(c => c.key))
  const [showConfig, setShowConfig] = useState(false)

  function toggleStatus(status: string) {
    setMonitoredStatuses(prev =>
      prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]
    )
  }

  function toggleColumn(key: string) {
    setVisibleColumns(prev =>
      prev.includes(key) ? prev.filter(c => c !== key) : [...prev, key]
    )
  }

  const filtered = activities.filter(a => monitoredStatuses.includes(a.status))
  const grouped = STATUS_CONFIG.reduce((acc, s) => {
    const items = filtered.filter(a => a.status === s.value)
    if (items.length > 0) acc[s.value] = items
    return acc
  }, {} as Record<string, Activity[]>)

  function hasCol(key: string) { return visibleColumns.includes(key) }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Painel de atendimento</h1>
          <p className="text-gray-500 text-sm mt-0.5">{filtered.length} atividade{filtered.length !== 1 ? 's' : ''} monitoradas</p>
        </div>
        <button onClick={() => setShowConfig(!showConfig)}
          className={cn('flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition',
            showConfig ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-700 hover:bg-gray-50')}>
          <Settings2 className="w-4 h-4" />
          Configurar
        </button>
      </div>

      {/* Painel de configuração */}
      {showConfig && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 grid grid-cols-2 gap-6">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Status monitorados</p>
            <div className="space-y-1.5">
              {STATUS_CONFIG.filter(s => s.group !== 'done').map(s => (
                <label key={s.value} className="flex items-center gap-2.5 cursor-pointer group">
                  <input type="checkbox" checked={monitoredStatuses.includes(s.value)}
                    onChange={() => toggleStatus(s.value)}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', s.bgColor, s.color)}>
                    {s.label}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Colunas visíveis</p>
            <div className="space-y-1.5">
              {ALL_COLUMNS.map(col => (
                <label key={col.key} className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={visibleColumns.includes(col.key)}
                    onChange={() => toggleColumn(col.key)}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                  <span className="text-sm text-gray-700">{col.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Lista por status */}
      <div className="space-y-2">
        {STATUS_CONFIG.filter(s => grouped[s.value]?.length).map((statusCfg) => {
          const items = grouped[statusCfg.value] ?? []
          return (
            <details key={statusCfg.value} open className="group bg-white rounded-xl border border-gray-200 overflow-hidden">
              <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none hover:bg-gray-50 transition list-none">
                <ChevronDown className="w-4 h-4 text-gray-400 group-open:rotate-0 -rotate-90 transition-transform" />
                <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold', statusCfg.bgColor, statusCfg.color)}>
                  {statusCfg.label}
                </span>
                <span className="text-sm text-gray-400">{items.length}</span>
              </summary>

              <table className="w-full text-sm">
                <thead>
                  <tr className="border-t border-gray-100 bg-gray-50/50">
                    <th className="text-left px-4 py-2 text-xs font-medium text-gray-400 w-full">Nome</th>
                    {hasCol('responsavel') && <th className="text-left px-4 py-2 text-xs font-medium text-gray-400 whitespace-nowrap">Responsável</th>}
                    {hasCol('ultimo_comentario') && <th className="text-left px-4 py-2 text-xs font-medium text-gray-400 whitespace-nowrap">Último comentário</th>}
                    {hasCol('prazo') && <th className="text-left px-4 py-2 text-xs font-medium text-gray-400 whitespace-nowrap">Prazo</th>}
                    {hasCol('prioridade') && <th className="text-left px-4 py-2 text-xs font-medium text-gray-400 whitespace-nowrap">Prioridade</th>}
                    {hasCol('layout') && <th className="text-left px-4 py-2 text-xs font-medium text-gray-400 whitespace-nowrap">Layout</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.map((activity) => {
                    const camp = campMap[activity.campaign_id]
                    const overdue = isOverdue(activity.due_date)
                    const days = daysUntil(activity.due_date)
                    const priority = PRIORITY_CONFIG[activity.priority as keyof typeof PRIORITY_CONFIG]
                    const assignees = (activity.activity_assignees as { profiles: { full_name: string | null; avatar_url: string | null } | null }[])
                      ?.map(a => a.profiles).filter(Boolean) ?? []
                    const comments = activity.activity_comments as { content: string; created_at: string; profiles: { full_name: string | null } | null }[]
                    const lastComment = comments?.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]

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
                        {hasCol('responsavel') && (
                          <td className="px-4 py-2.5">
                            {assignees.length > 0
                              ? <AvatarGroup users={assignees} />
                              : <span className="text-xs text-gray-300">—</span>}
                          </td>
                        )}
                        {hasCol('ultimo_comentario') && (
                          <td className="px-4 py-2.5 max-w-xs">
                            {lastComment ? (
                              <span className="text-xs text-gray-500 truncate block max-w-[200px]" title={lastComment.content}>
                                <span className="text-gray-400">{lastComment.profiles?.full_name?.split(' ')[0]}: </span>
                                {lastComment.content}
                              </span>
                            ) : <span className="text-xs text-gray-300">—</span>}
                          </td>
                        )}
                        {hasCol('prazo') && (
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            {activity.due_date ? (
                              <span className={cn('flex items-center gap-1 text-xs font-medium', overdue ? 'text-red-600' : days !== null && days <= 3 ? 'text-orange-500' : 'text-gray-600')}>
                                {overdue && <AlertCircle className="w-3 h-3" />}
                                {overdue ? `${Math.abs(days!)}d atraso` : days === 0 ? 'Hoje' : days === 1 ? 'Amanhã' : `${days}d`}
                              </span>
                            ) : <span className="text-xs text-gray-300">—</span>}
                          </td>
                        )}
                        {hasCol('prioridade') && (
                          <td className="px-4 py-2.5">
                            {activity.priority !== 'medium' ? (
                              <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', priority.bgColor, priority.color)}>
                                {priority.label}
                              </span>
                            ) : <span className="text-xs text-gray-300">—</span>}
                          </td>
                        )}
                        {hasCol('layout') && (
                          <td className="px-4 py-2.5">
                            {activity.layout_url ? (
                              <a href={activity.layout_url} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 hover:underline">
                                <ExternalLink className="w-3 h-3" /> Layout
                              </a>
                            ) : <span className="text-xs text-gray-300">—</span>}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </details>
          )
        })}

        {filtered.length === 0 && (
          <div className="text-center py-24 bg-white rounded-xl border border-gray-200">
            <p className="text-gray-900 font-medium">Nenhuma atividade nos status monitorados</p>
            <p className="text-gray-500 text-sm mt-1">Ajuste os status em "Configurar" para ver mais atividades.</p>
          </div>
        )}
      </div>
    </div>
  )
}
