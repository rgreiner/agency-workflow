'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { cn, isOverdue, daysUntil } from '@/lib/utils'
import { PRIORITY_CONFIG, type ActivityPriority } from '@/types'
import { AlertCircle, ExternalLink, ChevronDown, Columns3, Check } from 'lucide-react'
import { AvatarGroup } from '@/components/ui/Avatar'

// ── Column definitions ───────────────────────────────────────────────────────

type ColKey = 'responsavel' | 'prazo' | 'prioridade' | 'layout' | 'complexidade' | 'inicio'

const COL_DEFS: { key: ColKey; label: string; defaultOn: boolean }[] = [
  { key: 'responsavel',  label: 'Responsável',  defaultOn: true  },
  { key: 'prazo',        label: 'Prazo',         defaultOn: true  },
  { key: 'prioridade',   label: 'Prioridade',    defaultOn: true  },
  { key: 'layout',       label: 'Layout',        defaultOn: true  },
  { key: 'inicio',       label: 'Início',        defaultOn: false },
  { key: 'complexidade', label: 'Complexidade',  defaultOn: false },
]

const STORAGE_KEY = 'lista-cols-v1'

function defaultCols(): Record<ColKey, boolean> {
  return Object.fromEntries(COL_DEFS.map(c => [c.key, c.defaultOn])) as Record<ColKey, boolean>
}

// ── Types ────────────────────────────────────────────────────────────────────

interface Assignee {
  full_name: string | null
  avatar_url: string | null
}

interface Activity {
  id: string
  title: string
  status: string
  priority: string
  due_date: string | null
  start_date?: string | null
  complexity?: string | null
  layout_url: string | null
  campaign_id: string
  assignees: Assignee[]
}

interface CampInfo {
  name: string
  client: string
  workspaceId: string
}

interface Props {
  orgSlug: string
  activities: Activity[]
  campMap: Record<string, CampInfo>
  grouped: Record<string, Activity[]>
  statusConfig: { value: string; label: string; bgColor: string; color: string }[]
}

// ── Component ────────────────────────────────────────────────────────────────

export function ListaClient({ orgSlug, activities, campMap, grouped, statusConfig }: Props) {
  const [cols, setCols] = useState<Record<ColKey, boolean>>(defaultCols)
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) setCols({ ...defaultCols(), ...JSON.parse(saved) })
    } catch {}
  }, [])

  // Close picker on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function toggleCol(key: ColKey) {
    setCols(prev => {
      const next = { ...prev, [key]: !prev[key] }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  const totalCount = activities.length

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Lista de atividades</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {totalCount} atividade{totalCount !== 1 ? 's' : ''} em andamento
          </p>
        </div>

        {/* Column picker */}
        <div className="relative" ref={pickerRef}>
          <button
            onClick={() => setPickerOpen(o => !o)}
            className={cn(
              'inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border transition',
              pickerOpen
                ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                : 'bg-white border-gray-200 text-gray-500 hover:text-gray-700 hover:border-gray-300'
            )}
          >
            <Columns3 className="w-4 h-4" />
            Colunas
          </button>

          {pickerOpen && (
            <div className="absolute right-0 mt-2 w-52 bg-white rounded-xl border border-gray-200 shadow-lg py-2 z-20">
              <p className="px-3 pb-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100 mb-1">
                Colunas visíveis
              </p>
              {COL_DEFS.map(col => (
                <button
                  key={col.key}
                  onClick={() => toggleCol(col.key)}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition"
                >
                  <span>{col.label}</span>
                  <span className={cn(
                    'w-4 h-4 rounded border flex items-center justify-center transition',
                    cols[col.key]
                      ? 'bg-indigo-600 border-indigo-600'
                      : 'border-gray-300'
                  )}>
                    {cols[col.key] && <Check className="w-2.5 h-2.5 text-white" />}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {statusConfig.filter(s => grouped[s.value]?.length).map((statusCfg) => {
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
                    {/* Nome — sempre visível, sem label */}
                    <th className="text-left px-4 py-2 w-full" />
                    {cols.responsavel  && <th className="text-left px-4 py-2 text-xs font-medium text-gray-400 whitespace-nowrap">Responsável</th>}
                    {cols.inicio       && <th className="text-left px-4 py-2 text-xs font-medium text-gray-400 whitespace-nowrap">Início</th>}
                    {cols.prazo        && <th className="text-left px-4 py-2 text-xs font-medium text-gray-400 whitespace-nowrap">Prazo</th>}
                    {cols.prioridade   && <th className="text-left px-4 py-2 text-xs font-medium text-gray-400 whitespace-nowrap">Prioridade</th>}
                    {cols.complexidade && <th className="text-left px-4 py-2 text-xs font-medium text-gray-400 whitespace-nowrap">Complexidade</th>}
                    {cols.layout       && <th className="text-left px-4 py-2 text-xs font-medium text-gray-400 whitespace-nowrap">Layout</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.map((activity) => {
                    const camp = campMap[activity.campaign_id]
                    const overdue = isOverdue(activity.due_date)
                    const days = daysUntil(activity.due_date)
                    const priority = PRIORITY_CONFIG[activity.priority as ActivityPriority]

                    return (
                      <tr key={activity.id} className="hover:bg-gray-50/70 transition">
                        {/* Nome — sempre visível */}
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/${orgSlug}/workspaces/${camp?.workspaceId}/campaigns/${activity.campaign_id}/activities/${activity.id}`}
                            className="block group/link"
                          >
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

                        {cols.responsavel && (
                          <td className="px-4 py-2.5">
                            {activity.assignees.length > 0
                              ? <AvatarGroup users={activity.assignees} />
                              : <span className="text-xs text-gray-300">—</span>
                            }
                          </td>
                        )}

                        {cols.inicio && (
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            {activity.start_date
                              ? <span className="text-xs text-gray-500">{new Date(activity.start_date + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>
                              : <span className="text-xs text-gray-300">—</span>
                            }
                          </td>
                        )}

                        {cols.prazo && (
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            {activity.due_date ? (
                              <span className={cn('flex items-center gap-1 text-xs font-medium',
                                overdue ? 'text-red-600' : days !== null && days <= 3 ? 'text-orange-500' : 'text-gray-600'
                              )}>
                                {overdue && <AlertCircle className="w-3 h-3" />}
                                {overdue ? `${Math.abs(days!)}d atraso` : days === 0 ? 'Hoje' : days === 1 ? 'Amanhã' : `${days}d`}
                              </span>
                            ) : <span className="text-xs text-gray-300">—</span>}
                          </td>
                        )}

                        {cols.prioridade && (
                          <td className="px-4 py-2.5">
                            {activity.priority !== 'medium' ? (
                              <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', priority.bgColor, priority.color)}>
                                {priority.label}
                              </span>
                            ) : <span className="text-xs text-gray-300">—</span>}
                          </td>
                        )}

                        {cols.complexidade && (
                          <td className="px-4 py-2.5">
                            <span className="text-xs text-gray-500 capitalize">{activity.complexity ?? '—'}</span>
                          </td>
                        )}

                        {cols.layout && (
                          <td className="px-4 py-2.5">
                            {activity.layout_url ? (
                              <a href={activity.layout_url} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 hover:underline"
                                onClick={e => e.stopPropagation()}
                              >
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
