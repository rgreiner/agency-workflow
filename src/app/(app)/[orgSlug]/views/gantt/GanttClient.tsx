'use client'

import { useState, useEffect, useRef, useTransition } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Avatar, AvatarGroup } from '@/components/ui/Avatar'
import { STATUS_CONFIG } from '@/types'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { updateActivityDates } from '@/app/actions/activity'
import { useRouter } from 'next/navigation'

// ── Constants ─────────────────────────────────────────────────────────────

const DAY_W    = 44
const SIDEBAR_W = 220
const ROW_H    = 52
const HANDLE_W = 8

// Status → cores hexadecimais para as barras do Gantt
const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  briefing:              { bg: '#f3e8ff', border: '#a855f7', text: '#7e22ce' },
  pendente_cliente:      { bg: '#fff7ed', border: '#f97316', text: '#c2410c' },
  planejamento:          { bg: '#dbeafe', border: '#3b82f6', text: '#1d4ed8' },
  insight:               { bg: '#e0e7ff', border: '#6366f1', text: '#4338ca' },
  redacao:               { bg: '#cffafe', border: '#06b6d4', text: '#0e7490' },
  design:                { bg: '#fce7f3', border: '#ec4899', text: '#be185d' },
  edicao:                { bg: '#ffe4e6', border: '#f43f5e', text: '#be123c' },
  finalizacao:           { bg: '#ede9fe', border: '#8b5cf6', text: '#6d28d9' },
  revisao_interna:       { bg: '#fef3c7', border: '#f59e0b', text: '#b45309' },
  validacao_atendimento: { bg: '#fefce8', border: '#eab308', text: '#854d0e' },
  orcamento:             { bg: '#f7fee7', border: '#84cc16', text: '#4d7c0f' },
  producao_fornecedores: { bg: '#ccfbf1', border: '#14b8a6', text: '#0f766e' },
  producao_audiovisual:  { bg: '#e0f2fe', border: '#0ea5e9', text: '#0369a1' },
  validacao_midia:       { bg: '#dbeafe', border: '#3b82f6', text: '#1d4ed8' },
  midia:                 { bg: '#d1fae5', border: '#10b981', text: '#065f46' },
  social:                { bg: '#fae8ff', border: '#d946ef', text: '#86198f' },
  aprovacao_cliente:     { bg: '#fff7ed', border: '#f97316', text: '#c2410c' },
  implantacao_digital:   { bg: '#fefce8', border: '#eab308', text: '#854d0e' },
  implantacao_off:       { bg: '#fef3c7', border: '#f59e0b', text: '#b45309' },
  concluido:             { bg: '#dcfce7', border: '#22c55e', text: '#15803d' },
}

// ── Helpers ────────────────────────────────────────────────────────────────

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function fromYMD(s: string) {
  const [y,m,d] = s.split('-').map(Number)
  return new Date(y, m-1, d)
}
function addDays(d: Date, n: number) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r
}
function isToday(d: Date) { return d.toDateString() === new Date().toDateString() }
function isWeekend(d: Date) { return d.getDay() === 0 || d.getDay() === 6 }

// ── Types ──────────────────────────────────────────────────────────────────

type Activity = {
  id: string; title: string; status: string; priority: string
  start_date: string | null; due_date: string | null; campaign_id: string
  activity_assignees: unknown[]
}
type Profile  = { id: string; full_name: string | null; avatar_url: string | null }
type CampMap  = Record<string, { name: string; client: string; workspaceId: string }>
type Workspace = { id: string; name: string }

type DragState = {
  type: 'move' | 'resize-start' | 'resize-end'
  activityId: string
  startX: number
  origStart: string | null
  origEnd:   string | null
}

// ── Component ──────────────────────────────────────────────────────────────

export function GanttClient({ activities, campMap, profiles, workspaces, orgSlug }: {
  activities: Activity[]
  campMap: CampMap
  profiles: Profile[]
  workspaces: Workspace[]
  orgSlug: string
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  // View window
  const [viewStart, setViewStart] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7); return d
  })
  const DAYS = 35
  const days = Array.from({ length: DAYS }, (_, i) => addDays(viewStart, i))
  const todayIdx = days.findIndex(isToday)

  // Filters
  const [filterWorkspace, setFilterWorkspace] = useState('')
  const [filterPerson,    setFilterPerson]    = useState('')
  const [filterStatus,    setFilterStatus]    = useState('')

  // Drag
  const dragRef = useRef<DragState | null>(null)
  const [localDates, setLocalDates] = useState<Record<string, { start: string|null; end: string|null }>>({})
  const [isDragging, setIsDragging] = useState(false)

  // Navigation
  function move(n: number) { setViewStart(d => addDays(d, n)) }
  function goToday() { const d = new Date(); d.setDate(d.getDate()-7); setViewStart(d) }

  // Get effective dates (local override during drag)
  function getDates(a: Activity) {
    const ld = localDates[a.id]
    return { start: ld?.start ?? a.start_date, end: ld?.end ?? a.due_date }
  }

  // Bar position from dates
  function getBar(start: string|null, end: string|null) {
    if (!end) return null
    const vs = viewStart.getTime()
    const ve = vs + DAYS * 86400000
    const bs = start ? fromYMD(start).getTime() : fromYMD(end).getTime() - 86400000
    const be = fromYMD(end).getTime()
    if (be < vs || bs > ve) return null
    const cs = Math.max(bs, vs)
    const ce = Math.min(be, ve)
    const left  = Math.floor((cs - vs) / 86400000) * DAY_W
    const width = Math.max(Math.ceil((ce - cs) / 86400000) * DAY_W, DAY_W)
    return { left, width, clippedLeft: cs > bs, clippedRight: ce < be }
  }

  // Mouse drag handlers
  function startDrag(
    e: React.MouseEvent,
    type: DragState['type'],
    activity: Activity
  ) {
    e.preventDefault()
    e.stopPropagation()
    const { start, end } = getDates(activity)
    dragRef.current = { type, activityId: activity.id, startX: e.clientX, origStart: start, origEnd: end }
    setIsDragging(true)
  }

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const drag = dragRef.current
      if (!drag) return
      const dx = e.clientX - drag.startX
      const deltaDays = Math.round(dx / DAY_W)

      let newStart = drag.origStart ? fromYMD(drag.origStart) : null
      let newEnd   = drag.origEnd   ? fromYMD(drag.origEnd)   : null

      if (drag.type === 'move') {
        if (newStart) newStart = addDays(newStart, deltaDays)
        if (newEnd)   newEnd   = addDays(newEnd, deltaDays)
      } else if (drag.type === 'resize-start') {
        if (newStart) {
          newStart = addDays(newStart, deltaDays)
          if (newEnd && newStart > newEnd) newStart = new Date(newEnd)
        }
      } else {
        if (newEnd) {
          newEnd = addDays(newEnd, deltaDays)
          if (newStart && newEnd < newStart) newEnd = new Date(newStart)
        }
      }

      setLocalDates(prev => ({
        ...prev,
        [drag.activityId]: { start: newStart ? toYMD(newStart) : null, end: newEnd ? toYMD(newEnd) : null }
      }))
    }

    function onUp() {
      const drag = dragRef.current
      if (!drag) return
      const ld = localDates[drag.activityId] ?? { start: drag.origStart, end: drag.origEnd }

      // Só salva se as datas mudaram
      if (ld.start !== drag.origStart || ld.end !== drag.origEnd) {
        startTransition(async () => {
          await updateActivityDates(drag.activityId, ld.start, ld.end)
          router.refresh()
        })
      }

      dragRef.current = null
      setIsDragging(false)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [localDates, router])

  // Filter + group activities
  const filtered = activities.filter(a => {
    if (filterStatus && a.status !== filterStatus) return false
    const camp = campMap[a.campaign_id]
    if (filterWorkspace && camp?.workspaceId !== filterWorkspace) return false
    if (filterPerson) {
      const assignees = (a.activity_assignees as { profiles: Profile }[])?.map(x => x.profiles) ?? []
      if (!assignees.some(p => p?.id === filterPerson)) return false
    }
    return true
  })

  const assigneeMap: Record<string, { profile: Profile; activities: Activity[] }> = {}
  const unassigned: Activity[] = []

  filtered.forEach(a => {
    const assignees = (a.activity_assignees as { profiles: Profile }[])?.map(x => x.profiles).filter(Boolean) ?? []
    if (assignees.length === 0) {
      unassigned.push(a)
    } else {
      assignees.forEach(p => {
        if (!p?.id) return
        if (!assigneeMap[p.id]) assigneeMap[p.id] = { profile: p, activities: [] }
        assigneeMap[p.id].activities.push(a)
      })
    }
  })

  const groups = Object.values(assigneeMap).sort((a, b) =>
    (a.profile.full_name ?? '').localeCompare(b.profile.full_name ?? '')
  )

  function renderBar(activity: Activity) {
    const { start, end } = getDates(activity)
    const bar = getBar(start, end)
    if (!bar) return null

    const colors = STATUS_COLORS[activity.status] ?? { bg: '#f3f4f6', border: '#9ca3af', text: '#374151' }
    const assignees = (activity.activity_assignees as { profiles: Profile }[])?.map(x => x.profiles).filter(Boolean) ?? []

    return (
      <div
        className="absolute top-2 bottom-2 rounded-lg overflow-hidden flex items-center select-none"
        style={{
          left: bar.left, width: bar.width,
          backgroundColor: colors.bg,
          border: `1.5px solid ${colors.border}`,
          cursor: isDragging ? 'grabbing' : 'grab',
          zIndex: isDragging && dragRef.current?.activityId === activity.id ? 20 : 5,
        }}
        onMouseDown={e => {
          if ((e.target as HTMLElement).dataset.handle) return
          startDrag(e, 'move', activity)
        }}
        title={`${activity.title}\n${start ?? '?'} → ${end ?? '?'}`}
      >
        {/* Resize handle esquerdo */}
        {!bar.clippedLeft && (
          <div
            data-handle="left"
            className="absolute left-0 top-0 bottom-0 flex items-center justify-center"
            style={{ width: HANDLE_W, cursor: 'ew-resize', zIndex: 10 }}
            onMouseDown={e => startDrag(e, 'resize-start', activity)}
          >
            <div className="w-0.5 h-3 rounded-full opacity-40" style={{ backgroundColor: colors.border }} />
          </div>
        )}

        {/* Conteúdo */}
        <div className="flex items-center gap-1.5 px-2 flex-1 min-w-0 pointer-events-none"
             style={{ paddingLeft: bar.clippedLeft ? 8 : HANDLE_W + 4 }}>
          <span className="text-[11px] font-medium truncate" style={{ color: colors.text }}>
            {activity.title}
          </span>
          {assignees.length > 0 && bar.width > 80 && (
            <AvatarGroup users={assignees} max={2} />
          )}
        </div>

        {/* Resize handle direito */}
        {!bar.clippedRight && (
          <div
            data-handle="right"
            className="absolute right-0 top-0 bottom-0 flex items-center justify-center"
            style={{ width: HANDLE_W, cursor: 'ew-resize', zIndex: 10 }}
            onMouseDown={e => startDrag(e, 'resize-end', activity)}
          >
            <div className="w-0.5 h-3 rounded-full opacity-40" style={{ backgroundColor: colors.border }} />
          </div>
        )}
      </div>
    )
  }

  function renderCalRow(activity: Activity) {
    return (
      <div key={activity.id} className="flex border-b border-gray-50 last:border-0" style={{ height: ROW_H }}>
        {/* Sidebar */}
        <div className="shrink-0 border-r border-gray-100 px-3 flex flex-col justify-center" style={{ width: SIDEBAR_W }}>
          <span className="text-[10px] text-gray-400 truncate">
            {campMap[activity.campaign_id]?.client} › {campMap[activity.campaign_id]?.name}
          </span>
          <Link
            href={`/${orgSlug}/workspaces/${campMap[activity.campaign_id]?.workspaceId}/campaigns/${activity.campaign_id}/activities/${activity.id}`}
            className="text-xs text-gray-700 font-medium hover:text-indigo-600 transition truncate block"
          >
            {activity.title}
          </Link>
        </div>

        {/* Calendar area */}
        <div className="relative flex-1">
          {days.map((day, i) => isWeekend(day) && (
            <div key={i} className="absolute inset-y-0 bg-gray-50/70 pointer-events-none"
              style={{ left: i * DAY_W, width: DAY_W }} />
          ))}
          {todayIdx >= 0 && (
            <div className="absolute inset-y-0 w-px bg-red-400 pointer-events-none z-10"
              style={{ left: todayIdx * DAY_W + DAY_W / 2 }} />
          )}
          {renderBar(activity)}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 flex flex-col h-full">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Gantt por responsável</h1>
          <p className="text-gray-500 text-sm mt-0.5">{filtered.length} atividade{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={goToday}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition text-gray-700 font-medium">
            Hoje
          </button>
          <button onClick={() => move(-7)} className="p-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
            <ChevronLeft className="w-4 h-4 text-gray-600" />
          </button>
          <button onClick={() => move(7)}  className="p-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {/* Workspace */}
        <select value={filterWorkspace} onChange={e => setFilterWorkspace(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400">
          <option value="">Todos os clientes</option>
          {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>

        {/* Person */}
        <select value={filterPerson} onChange={e => setFilterPerson(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400">
          <option value="">Todas as pessoas</option>
          {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name ?? p.id}</option>)}
        </select>

        {/* Status */}
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400">
          <option value="">Todos os status</option>
          {STATUS_CONFIG.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        {/* Clear filters */}
        {(filterWorkspace || filterPerson || filterStatus) && (
          <button onClick={() => { setFilterWorkspace(''); setFilterPerson(''); setFilterStatus('') }}
            className="text-xs text-gray-400 hover:text-gray-600 transition flex items-center gap-1">
            Limpar filtros
          </button>
        )}
      </div>

      {/* Gantt table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-auto flex-1"
           style={{ userSelect: isDragging ? 'none' : 'auto' }}>
        {/* Calendar header */}
        <div className="flex border-b border-gray-200 sticky top-0 bg-white z-30">
          <div className="shrink-0 border-r border-gray-200" style={{ width: SIDEBAR_W }} />
          <div className="flex">
            {days.map((day, i) => (
              <div key={i}
                className={cn(
                  'flex flex-col items-center justify-center text-xs border-r border-gray-100 shrink-0 py-2',
                  isToday(day) ? 'bg-indigo-600 text-white' : isWeekend(day) ? 'bg-gray-50 text-gray-400' : 'text-gray-600'
                )}
                style={{ width: DAY_W }}>
                <span className="font-semibold">{day.getDate()}</span>
                <span className="text-[10px] opacity-70">
                  {day.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Groups */}
        {groups.map(({ profile, activities: groupActivities }) => (
          <div key={profile.id} className="border-b border-gray-100 last:border-0">
            <div className="flex items-center gap-2.5 px-4 py-2.5 bg-gray-50/60 border-b border-gray-100 sticky"
                 style={{ zIndex: 20 }}>
              <Avatar name={profile.full_name} avatarUrl={profile.avatar_url} size="sm" />
              <span className="text-sm font-semibold text-gray-800">{profile.full_name ?? 'Sem nome'}</span>
              <span className="text-xs text-gray-400">{groupActivities.length} tarefa{groupActivities.length !== 1 ? 's' : ''}</span>
            </div>
            {groupActivities.map(a => renderCalRow(a))}
          </div>
        ))}

        {unassigned.length > 0 && (
          <div className="border-t border-gray-200">
            <div className="flex items-center gap-2.5 px-4 py-2.5 bg-gray-50/60 border-b border-gray-100">
              <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs text-gray-500">—</div>
              <span className="text-sm font-semibold text-gray-500">Sem responsável</span>
              <span className="text-xs text-gray-400">{unassigned.length} tarefa{unassigned.length !== 1 ? 's' : ''}</span>
            </div>
            {unassigned.map(a => renderCalRow(a))}
          </div>
        )}

        {filtered.length === 0 && (
          <div className="text-center py-20 text-gray-400 text-sm">
            Nenhuma atividade encontrada com os filtros atuais.
          </div>
        )}
      </div>
    </div>
  )
}
