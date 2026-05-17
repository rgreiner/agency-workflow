'use client'

import { useRef } from 'react'
import Link from 'next/link'
import { cn, isOverdue } from '@/lib/utils'
import { Avatar, AvatarGroup } from '@/components/ui/Avatar'
import { STATUS_CONFIG } from '@/types'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'

type Activity = {
  id: string
  title: string
  status: string
  priority: string
  start_date: string | null
  due_date: string | null
  campaign_id: string
  activity_assignees: unknown[]
}

type Profile = { id: string; full_name: string | null; avatar_url: string | null }
type CampMap = Record<string, { name: string; client: string; workspaceId: string }>

function getDaysInView(startDate: Date, days: number) {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(startDate)
    d.setDate(d.getDate() + i)
    return d
  })
}

function isToday(date: Date) {
  const today = new Date()
  return date.toDateString() === today.toDateString()
}

function isWeekend(date: Date) {
  return date.getDay() === 0 || date.getDay() === 6
}

const DAY_WIDTH = 44

export function GanttClient({ activities, campMap, profiles, orgSlug }: {
  activities: Activity[]
  campMap: CampMap
  profiles: Profile[]
  orgSlug: string
}) {
  const today = new Date()
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(today)
    d.setDate(d.getDate() - 7) // 7 dias antes de hoje
    return d
  })
  const DAYS = 30

  const days = getDaysInView(startDate, DAYS)
  const todayIndex = days.findIndex(d => isToday(d))

  function moveWeek(dir: 1 | -1) {
    setStartDate(prev => {
      const d = new Date(prev)
      d.setDate(d.getDate() + dir * 7)
      return d
    })
  }

  function goToToday() {
    const d = new Date(today)
    d.setDate(d.getDate() - 7)
    setStartDate(d)
  }

  // Group activities by assignee
  const assigneeMap: Record<string, { profile: Profile; activities: Activity[] }> = {}
  const unassigned: Activity[] = []

  activities.forEach(activity => {
    const assignees = (activity.activity_assignees as { profiles: Profile }[])?.map(a => a.profiles) ?? []
    if (assignees.length === 0) {
      unassigned.push(activity)
    } else {
      assignees.forEach(p => {
        if (!p?.id) return
        if (!assigneeMap[p.id]) assigneeMap[p.id] = { profile: p, activities: [] }
        assigneeMap[p.id].activities.push(activity)
      })
    }
  })

  const groups = Object.values(assigneeMap).sort((a, b) =>
    (a.profile.full_name ?? '').localeCompare(b.profile.full_name ?? '')
  )

  function getBarStyle(activity: Activity) {
    if (!activity.due_date) return null

    const viewStart = startDate.getTime()
    const viewEnd = viewStart + DAYS * 24 * 60 * 60 * 1000

    // Usa start_date ou cai no dia antes do due_date como mínimo
    const barStart = activity.start_date
      ? new Date(activity.start_date).getTime()
      : new Date(activity.due_date).getTime() - 24 * 60 * 60 * 1000
    const barEnd = new Date(activity.due_date).getTime()

    // Barra inteiramente fora da janela
    if (barEnd < viewStart || barStart > viewEnd) return null

    // Clipa nos limites da janela
    const clippedStart = Math.max(barStart, viewStart)
    const clippedEnd = Math.min(barEnd, viewEnd)

    const left = Math.floor((clippedStart - viewStart) / (24 * 60 * 60 * 1000)) * DAY_WIDTH
    const width = Math.max(
      Math.ceil((clippedEnd - clippedStart) / (24 * 60 * 60 * 1000)) * DAY_WIDTH,
      DAY_WIDTH // mínimo 1 dia
    )

    return { left, width }
  }

  const statusCfg = Object.fromEntries(STATUS_CONFIG.map(s => [s.value, s]))

  const SIDEBAR_W = 220

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Gantt por responsável</h1>
          <p className="text-gray-500 text-sm mt-0.5">{activities.length} atividade{activities.length !== 1 ? 's' : ''} com prazo</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={goToToday}
            className="px-3 py-2 text-sm border border-gray-300 rounded-xl hover:bg-gray-50 transition text-gray-700 font-medium">
            Hoje
          </button>
          <button onClick={() => moveWeek(-1)}
            className="p-2 border border-gray-300 rounded-xl hover:bg-gray-50 transition">
            <ChevronLeft className="w-4 h-4 text-gray-600" />
          </button>
          <button onClick={() => moveWeek(1)}
            className="p-2 border border-gray-300 rounded-xl hover:bg-gray-50 transition">
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Header do calendário */}
        <div className="flex border-b border-gray-200 sticky top-0 bg-white z-10">
          <div className="shrink-0 border-r border-gray-200 bg-white" style={{ width: SIDEBAR_W }} />
          <div className="flex">
            {days.map((day, i) => (
              <div key={i}
                className={cn(
                  'flex flex-col items-center justify-center text-xs border-r border-gray-100 shrink-0 py-2',
                  isToday(day) ? 'bg-indigo-600 text-white' : isWeekend(day) ? 'bg-gray-50 text-gray-400' : 'text-gray-600'
                )}
                style={{ width: DAY_WIDTH }}>
                <span className="font-medium">{day.getDate()}</span>
                <span className="text-[10px] opacity-70">
                  {day.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Grupos por pessoa */}
        {groups.map(({ profile, activities: groupActivities }) => (
          <div key={profile.id} className="border-b border-gray-100 last:border-b-0">
            {/* Nome da pessoa */}
            <div className="flex items-center gap-2.5 px-4 py-3 bg-gray-50/50 border-b border-gray-100">
              <Avatar name={profile.full_name} avatarUrl={profile.avatar_url} />
              <span className="text-sm font-semibold text-gray-800">{profile.full_name ?? 'Sem nome'}</span>
              <span className="text-xs text-gray-400">{groupActivities.length} tarefa{groupActivities.length !== 1 ? 's' : ''}</span>
            </div>

            {/* Barras */}
            <div className="relative">
              {groupActivities.map((activity) => {
                const bar = getBarStyle(activity)
                const camp = campMap[activity.campaign_id]
                const cfg = statusCfg[activity.status]
                const overdue = isOverdue(activity.due_date)
                const assignees = (activity.activity_assignees as { profiles: Profile }[])?.map(a => a.profiles).filter(Boolean) ?? []

                return (
                  <div key={activity.id} className="flex border-b border-gray-50 last:border-b-0 h-14">
                    {/* Sidebar info */}
                    <div className="shrink-0 border-r border-gray-100 px-3 flex flex-col justify-center" style={{ width: SIDEBAR_W }}>
                      {camp && <span className="text-[10px] text-gray-400 truncate">{camp.client} › {camp.name}</span>}
                      <Link href={`/${orgSlug}/workspaces/${camp?.workspaceId}/campaigns/${activity.campaign_id}/activities/${activity.id}`}
                        className="text-xs text-gray-700 font-medium hover:text-indigo-600 transition truncate block">
                        {activity.title}
                      </Link>
                    </div>

                    {/* Área do calendário */}
                    <div className="relative flex-1">
                      {/* Faixas de fim de semana */}
                      {days.map((day, i) => isWeekend(day) && (
                        <div key={i} className="absolute top-0 bottom-0 bg-gray-50/60"
                          style={{ left: i * DAY_WIDTH, width: DAY_WIDTH }} />
                      ))}
                      {/* Linha do hoje */}
                      {todayIndex >= 0 && (
                        <div className="absolute top-0 bottom-0 w-0.5 bg-red-400 z-10"
                          style={{ left: todayIndex * DAY_WIDTH + DAY_WIDTH / 2 }} />
                      )}

                      {/* Barra da tarefa */}
                      {bar && (
                        <div
                          className={cn(
                            'absolute top-2 bottom-2 rounded-lg flex items-center px-2 gap-1.5 overflow-hidden cursor-pointer',
                            overdue ? 'bg-red-100 border border-red-200' : 'bg-green-100 border border-green-200'
                          )}
                          style={{ left: bar.left, width: bar.width }}
                          title={activity.title}>
                          <span className={cn('w-2 h-2 rounded-full shrink-0', overdue ? 'bg-red-400' : 'bg-green-400')} />
                          <span className="text-xs font-medium truncate text-gray-700 flex-1">{activity.title}</span>
                          <AvatarGroup users={assignees} max={2} />
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {/* Sem responsável */}
        {unassigned.length > 0 && (
          <div className="border-t border-gray-200">
            <div className="flex items-center gap-2.5 px-4 py-3 bg-gray-50/50 border-b border-gray-100">
              <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs text-gray-500">?</div>
              <span className="text-sm font-semibold text-gray-500">Sem responsável</span>
              <span className="text-xs text-gray-400">{unassigned.length} tarefa{unassigned.length !== 1 ? 's' : ''}</span>
            </div>
            {unassigned.map((activity) => {
              const camp = campMap[activity.campaign_id]
              return (
                <div key={activity.id} className="flex border-b border-gray-50 last:border-b-0 h-14">
                  <div className="shrink-0 border-r border-gray-100 px-3 flex flex-col justify-center" style={{ width: SIDEBAR_W }}>
                    {camp && <span className="text-[10px] text-gray-400 truncate">{camp.client} › {camp.name}</span>}
                    <Link href={`/${orgSlug}/workspaces/${camp?.workspaceId}/campaigns/${activity.campaign_id}/activities/${activity.id}`}
                      className="text-xs text-gray-500 italic hover:text-indigo-600 transition truncate block">
                      {activity.title}
                    </Link>
                  </div>
                  <div className="flex-1" />
                </div>
              )
            })}
          </div>
        )}

        {activities.length === 0 && (
          <div className="text-center py-20 text-gray-400 text-sm">
            Nenhuma atividade com prazo definido.
          </div>
        )}
      </div>
    </div>
  )
}
