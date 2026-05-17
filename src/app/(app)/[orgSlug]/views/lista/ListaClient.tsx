'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { cn, isOverdue, daysUntil } from '@/lib/utils'
import { PRIORITY_CONFIG, STATUS_CONFIG, type ActivityPriority } from '@/types'
import { AlertCircle, ExternalLink, ChevronDown, Columns3, Check } from 'lucide-react'
import { AvatarGroup } from '@/components/ui/Avatar'

// ── Column definitions ────────────────────────────────────────────────────

type ColKey = 'responsavel' | 'prazo' | 'prioridade' | 'layout' | 'complexidade' | 'inicio'

const COL_DEFS: { key: ColKey; label: string; defaultOn: boolean; width: string }[] = [
  { key: 'responsavel',  label: 'Responsável',  defaultOn: true,  width: 'w-32' },
  { key: 'prazo',        label: 'Prazo',         defaultOn: true,  width: 'w-24' },
  { key: 'prioridade',   label: 'Prioridade',    defaultOn: true,  width: 'w-24' },
  { key: 'layout',       label: 'Layout',        defaultOn: true,  width: 'w-20' },
  { key: 'inicio',       label: 'Início',        defaultOn: false, width: 'w-20' },
  { key: 'complexidade', label: 'Complexidade',  defaultOn: false, width: 'w-28' },
]

const STORAGE_KEY = 'lista-cols-v2'

function defaultCols(): Record<ColKey, boolean> {
  return Object.fromEntries(COL_DEFS.map(c => [c.key, c.defaultOn])) as Record<ColKey, boolean>
}

// ── Types ─────────────────────────────────────────────────────────────────

interface Assignee { full_name: string | null; avatar_url: string | null }
interface Activity {
  id: string; title: string; status: string; priority: string
  due_date: string | null; start_date?: string | null; complexity?: string | null
  layout_url: string | null; campaign_id: string; assignees: Assignee[]
}
interface CampInfo { name: string; client: string; workspaceId: string }
interface Props {
  orgSlug: string
  activities: Activity[]
  campMap: Record<string, CampInfo>
  grouped: Record<string, Activity[]>
  statusConfig: { value: string; label: string; bgColor: string; color: string }[]
}

// ── Component ─────────────────────────────────────────────────────────────

export function ListaClient({ orgSlug, activities, campMap, grouped, statusConfig }: Props) {
  const [cols, setCols] = useState<Record<ColKey, boolean>>(defaultCols)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) setCols({ ...defaultCols(), ...JSON.parse(saved) })
    } catch {}
  }, [])

  useEffect(() => {
    function onOut(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [])

  function toggleCol(key: ColKey) {
    setCols(prev => {
      const next = { ...prev, [key]: !prev[key] }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  function toggleGroup(status: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(status) ? next.delete(status) : next.add(status)
      return next
    })
  }

  const visibleCols = COL_DEFS.filter(c => cols[c.key])
  const totalCount  = activities.length
  const activeGroups = statusConfig.filter(s => grouped[s.value]?.length)

  return (
    <div className="p-6">

      {/* Page header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Lista de atividades</h1>
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
                    cols[col.key] ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'
                  )}>
                    {cols[col.key] && <Check className="w-2.5 h-2.5 text-white" />}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">

        {/* Single column header */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-gray-50/60">
          <div className="flex-1 text-xs font-medium text-gray-400" />
          {visibleCols.map(col => (
            <div key={col.key} className={cn('text-xs font-medium text-gray-400 shrink-0', col.width)}>
              {col.label}
            </div>
          ))}
          {/* spacer for status badge */}
          <div className="w-32 text-xs font-medium text-gray-400 shrink-0">Status</div>
        </div>

        {/* Status groups */}
        {activeGroups.length === 0 ? (
          <div className="text-center py-24">
            <p className="text-gray-900 font-medium">Nenhuma atividade em andamento</p>
            <p className="text-gray-500 text-sm mt-1">Todas as atividades estão concluídas ou ainda não foram criadas.</p>
          </div>
        ) : (
          activeGroups.map(statusCfg => {
            const items = grouped[statusCfg.value] ?? []
            const isOpen = !collapsed.has(statusCfg.value)

            return (
              <div key={statusCfg.value} className="border-b border-gray-100 last:border-0">

                {/* Group header */}
                <button
                  onClick={() => toggleGroup(statusCfg.value)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-gray-50/80 transition text-left"
                >
                  <ChevronDown className={cn(
                    'w-3.5 h-3.5 text-gray-400 transition-transform shrink-0',
                    !isOpen && '-rotate-90'
                  )} />
                  <span className={cn('text-xs font-semibold px-2.5 py-0.5 rounded-full', statusCfg.bgColor, statusCfg.color)}>
                    {statusCfg.label}
                  </span>
                  <span className="text-xs text-gray-400">{items.length}</span>
                </button>

                {/* Activity rows */}
                {isOpen && (
                  <div className="divide-y divide-gray-50">
                    {items.map(activity => {
                      const camp    = campMap[activity.campaign_id]
                      const overdue = isOverdue(activity.due_date)
                      const days    = daysUntil(activity.due_date)
                      const priority = PRIORITY_CONFIG[activity.priority as ActivityPriority]
                      const statusCfgRow = STATUS_CONFIG.find(s => s.value === activity.status)

                      return (
                        <div
                          key={activity.id}
                          className="flex items-center gap-2 px-4 py-2.5 hover:bg-gray-50/60 transition group"
                        >
                          {/* Name — takes remaining space */}
                          <div className="flex-1 min-w-0">
                            <Link
                              href={`/${orgSlug}/workspaces/${camp?.workspaceId}/campaigns/${activity.campaign_id}/activities/${activity.id}`}
                              className="block"
                            >
                              {camp && (
                                <span className="text-[11px] text-gray-400 block leading-tight mb-0.5">
                                  {camp.client} / {camp.name}
                                </span>
                              )}
                              <span className="text-sm font-medium text-gray-900 group-hover:text-indigo-600 transition truncate block">
                                {activity.title}
                              </span>
                            </Link>
                          </div>

                          {/* Responsável */}
                          {cols.responsavel && (
                            <div className="w-32 shrink-0">
                              {activity.assignees.length > 0
                                ? <AvatarGroup users={activity.assignees} />
                                : <span className="text-xs text-gray-300">—</span>
                              }
                            </div>
                          )}

                          {/* Início */}
                          {cols.inicio && (
                            <div className="w-20 shrink-0">
                              {activity.start_date
                                ? <span className="text-xs text-gray-500">
                                    {new Date(activity.start_date + 'T00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                                  </span>
                                : <span className="text-xs text-gray-300">—</span>
                              }
                            </div>
                          )}

                          {/* Prazo */}
                          {cols.prazo && (
                            <div className="w-24 shrink-0">
                              {activity.due_date ? (
                                <span className={cn(
                                  'text-xs font-medium flex items-center gap-1',
                                  overdue ? 'text-red-600' : days !== null && days <= 3 ? 'text-orange-500' : 'text-gray-600'
                                )}>
                                  {overdue && <AlertCircle className="w-3 h-3 shrink-0" />}
                                  {overdue ? `${Math.abs(days!)}d atraso` : days === 0 ? 'Hoje' : days === 1 ? 'Amanhã' : `${days}d`}
                                </span>
                              ) : <span className="text-xs text-gray-300">—</span>}
                            </div>
                          )}

                          {/* Prioridade */}
                          {cols.prioridade && (
                            <div className="w-24 shrink-0">
                              {activity.priority !== 'medium' ? (
                                <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', priority.bgColor, priority.color)}>
                                  {priority.label}
                                </span>
                              ) : <span className="text-xs text-gray-300">—</span>}
                            </div>
                          )}

                          {/* Complexidade */}
                          {cols.complexidade && (
                            <div className="w-28 shrink-0">
                              <span className="text-xs text-gray-500 capitalize">{activity.complexity ?? '—'}</span>
                            </div>
                          )}

                          {/* Layout */}
                          {cols.layout && (
                            <div className="w-20 shrink-0">
                              {activity.layout_url ? (
                                <a
                                  href={activity.layout_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={e => e.stopPropagation()}
                                  className="inline-flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 hover:underline"
                                >
                                  <ExternalLink className="w-3 h-3" /> Layout
                                </a>
                              ) : <span className="text-xs text-gray-300">—</span>}
                            </div>
                          )}

                          {/* Status pill — sempre visível */}
                          <div className="w-32 shrink-0">
                            {statusCfgRow && (
                              <span className={cn('text-xs font-medium px-2.5 py-1 rounded-md', statusCfgRow.bgColor, statusCfgRow.color)}>
                                {statusCfgRow.label}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
