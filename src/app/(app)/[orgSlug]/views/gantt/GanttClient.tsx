'use client'

import { useState, useRef, useTransition } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Avatar, AvatarGroup } from '@/components/ui/Avatar'
import { STATUS_CONFIG } from '@/types'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { updateActivityDates } from '@/app/actions/activity'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

// ── Constants ─────────────────────────────────────────────────────────────

const DAY_W     = 44
const SIDEBAR_W = 220
const ROW_H     = 52
const HANDLE_W  = 10
const DAYS      = 35

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
  const clean = s.slice(0, 10)  // handle ISO timestamps like 2026-05-18T00:00:00+00:00
  const [y, m, d] = clean.split('-').map(Number); return new Date(y, m - 1, d)
}
function addDays(d: Date, n: number) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r
}
function isToday(d: Date) { return d.toDateString() === new Date().toDateString() }
function isWeekend(d: Date) { return d.getDay() === 0 || d.getDay() === 6 }

// ── Types ──────────────────────────────────────────────────────────────────

type Activity = {
  id: string; title: string; status: string; priority: string
  start_date: string|null; due_date: string|null; campaign_id: string
  activity_assignees: unknown[]
}
type Profile   = { id: string; full_name: string|null; avatar_url: string|null }
type CampMap   = Record<string, { name: string; client: string; workspaceId: string }>
type Workspace = { id: string; name: string }

type DragState = {
  type: 'move' | 'resize-start' | 'resize-end'
  activityId: string
  startX: number
  deltaX: number          // pixel delta from startX
  origStart: string|null
  origEnd:   string|null
}

type CalState = { startX: number; origViewStart: Date }

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

  // ── View state ────────────────────────────────────────────────────────
  const [viewStart, setViewStart] = useState<Date>(() => {
    const d = new Date(); d.setDate(d.getDate() - 7); return d
  })

  // ── Filters ───────────────────────────────────────────────────────────
  const [filterWorkspace, setFilterWorkspace] = useState('')
  const [filterPerson,    setFilterPerson]    = useState('')
  const [filterStatus,    setFilterStatus]    = useState('')

  // ── Drag state: BOTH a ref (for event handlers) and state (for render) ─
  // The ref is read immediately in event handlers (no stale closure).
  // The state triggers re-renders to update bar positions.
  const dragRef = useRef<DragState | null>(null)
  const [drag,   setDrag] = useState<DragState | null>(null)

  // Calendar scrub — same dual approach
  const calRef = useRef<CalState | null>(null)

  // ── Calendar days ─────────────────────────────────────────────────────
  const days     = Array.from({ length: DAYS }, (_, i) => addDays(viewStart, i))
  const todayIdx = days.findIndex(isToday)

  // ── Effective dates for an activity (incorporates live drag delta) ─────
  // Called during render — reads from `drag` state (always current after re-render).
  function effectiveDates(a: Activity): { start: string|null; end: string|null } {
    const d = drag
    if (!d || d.activityId !== a.id) return { start: a.start_date, end: a.due_date }

    const days = Math.round(d.deltaX / DAY_W)
    let ns = d.origStart ? fromYMD(d.origStart) : null
    let ne = d.origEnd   ? fromYMD(d.origEnd)   : null

    if (d.type === 'move') {
      if (ns) ns = addDays(ns, days)
      if (ne) ne = addDays(ne, days)
    } else if (d.type === 'resize-start') {
      if (ns) { ns = addDays(ns, days); if (ne && ns > ne) ns = new Date(ne) }
    } else {
      if (ne) { ne = addDays(ne, days); if (ns && ne < ns) ne = new Date(ns) }
    }

    return { start: ns ? toYMD(ns) : null, end: ne ? toYMD(ne) : null }
  }

  // ── Bar geometry ──────────────────────────────────────────────────────
  function barGeometry(start: string|null, end: string|null) {
    if (!end) return null
    const vs = viewStart.getTime()
    const ve = vs + DAYS * 86400000
    const bs = start ? fromYMD(start).getTime() : fromYMD(end).getTime() - 86400000
    const be = fromYMD(end).getTime()
    if (be <= vs || bs >= ve) return null
    const cs = Math.max(bs, vs)
    const ce = Math.min(be, ve)
    return {
      left:         Math.floor((cs - vs) / 86400000) * DAY_W,
      width:        Math.max(Math.ceil((ce - cs) / 86400000) * DAY_W, DAY_W),
      clippedLeft:  cs > bs,
      clippedRight: ce < be,
    }
  }

  // ── Bar pointer handlers ──────────────────────────────────────────────

  function startBarDrag(e: React.PointerEvent, type: DragState['type'], a: Activity) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const state: DragState = {
      type,
      activityId: a.id,
      startX: e.clientX,
      deltaX: 0,
      origStart: a.start_date,
      origEnd:   a.due_date,
    }
    dragRef.current = state   // update ref immediately (no async)
    setDrag(state)            // schedule re-render
  }

  function onBarPointerMove(e: React.PointerEvent, activityId: string) {
    // IMPORTANT: read from ref, NOT from `drag` state.
    // Between pointerDown and the first re-render, `drag` state is still null.
    const d = dragRef.current
    if (!d || d.activityId !== activityId) return
    const dx = e.clientX - d.startX
    if (dx === d.deltaX) return           // no change
    const updated = { ...d, deltaX: dx }
    dragRef.current = updated             // keep ref in sync
    setDrag(updated)                      // trigger re-render
  }

  function onBarPointerUp(e: React.PointerEvent, a: Activity) {
    const d = dragRef.current             // read from ref
    if (!d || d.activityId !== a.id) return
    ;(e.currentTarget as Element).releasePointerCapture(e.pointerId)

    // Compute final dates from ref state
    const deltaDays = Math.round(d.deltaX / DAY_W)
    let ns = d.origStart ? fromYMD(d.origStart) : null
    let ne = d.origEnd   ? fromYMD(d.origEnd)   : null

    if (d.type === 'move') {
      if (ns) ns = addDays(ns, deltaDays)
      if (ne) ne = addDays(ne, deltaDays)
    } else if (d.type === 'resize-start') {
      if (ns) { ns = addDays(ns, deltaDays); if (ne && ns > ne) ns = new Date(ne) }
    } else {
      if (ne) { ne = addDays(ne, deltaDays); if (ns && ne < ns) ne = new Date(ns) }
    }

    const finalStart = ns ? toYMD(ns) : null
    const finalEnd   = ne ? toYMD(ne) : null

    dragRef.current = null
    setDrag(null)

    // Normalize originals for comparison (server may return ISO timestamps)
    const origStart = a.start_date ? a.start_date.slice(0, 10) : null
    const origEnd   = a.due_date   ? a.due_date.slice(0, 10)   : null

    if (finalStart !== origStart || finalEnd !== origEnd) {
      startTransition(async () => {
        const result = await updateActivityDates(a.id, finalStart, finalEnd)
        if (result?.error) toast.error(result.error)
        else router.refresh()
      })
    }
  }

  // ── Calendar scrub handlers ───────────────────────────────────────────
  // Drag RIGHT = future dates appear | Drag LEFT = past dates appear

  function onCalPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    calRef.current = { startX: e.clientX, origViewStart: viewStart }
  }

  function onCalPointerMove(e: React.PointerEvent) {
    const c = calRef.current
    if (!c) return
    const dx = e.clientX - c.startX
    // Positive dx (drag right) → positive delta → viewStart advances → future
    const delta = Math.round(dx / DAY_W)
    setViewStart(addDays(c.origViewStart, delta))
  }

  function onCalPointerUp(e: React.PointerEvent) {
    ;(e.currentTarget as Element).releasePointerCapture(e.pointerId)
    calRef.current = null
  }

  // ── Filtering + grouping ──────────────────────────────────────────────

  const filtered = activities.filter(a => {
    if (filterStatus    && a.status !== filterStatus) return false
    const camp = campMap[a.campaign_id]
    if (filterWorkspace && camp?.workspaceId !== filterWorkspace) return false
    if (filterPerson) {
      const ps = (a.activity_assignees as { profiles: Profile }[])?.map(x => x.profiles) ?? []
      if (!ps.some(p => p?.id === filterPerson)) return false
    }
    return true
  })

  const groupMap: Record<string, { profile: Profile; activities: Activity[] }> = {}
  const unassigned: Activity[] = []
  filtered.forEach(a => {
    const ps = (a.activity_assignees as { profiles: Profile }[])?.map(x => x.profiles).filter(Boolean) ?? []
    if (!ps.length) { unassigned.push(a); return }
    ps.forEach(p => {
      if (!p?.id) return
      if (!groupMap[p.id]) groupMap[p.id] = { profile: p, activities: [] }
      groupMap[p.id].activities.push(a)
    })
  })
  const groups = Object.values(groupMap).sort((a, b) =>
    (a.profile.full_name ?? '').localeCompare(b.profile.full_name ?? ''))

  // ── Render bar ────────────────────────────────────────────────────────

  function renderBar(a: Activity) {
    const { start, end } = effectiveDates(a)
    const geo  = barGeometry(start, end)
    if (!geo) return null

    const clrs   = STATUS_COLORS[a.status] ?? { bg: '#f3f4f6', border: '#9ca3af', text: '#374151' }
    const asns   = (a.activity_assignees as { profiles: Profile }[])?.map(x => x.profiles).filter(Boolean) ?? []
    const active = drag?.activityId === a.id

    return (
      <div
        className="absolute top-2 bottom-2 rounded-lg flex items-center overflow-hidden select-none"
        style={{
          left:            geo.left,
          width:           geo.width,
          backgroundColor: clrs.bg,
          border:          `1.5px solid ${clrs.border}`,
          cursor:          active ? 'grabbing' : 'grab',
          zIndex:          active ? 30 : 5,
          boxShadow:       active ? `0 4px 16px ${clrs.border}55` : undefined,
          touchAction:     'none',
        }}
        onPointerDown={e => {
          if ((e.target as HTMLElement).closest('[data-handle]')) return
          startBarDrag(e, 'move', a)
        }}
        onPointerMove={e => onBarPointerMove(e, a.id)}
        onPointerUp={e => onBarPointerUp(e, a)}
        onPointerCancel={() => { dragRef.current = null; setDrag(null) }}
      >
        {/* Left resize handle */}
        {!geo.clippedLeft && (
          <div
            data-handle="left"
            className="absolute left-0 top-0 bottom-0 z-10 flex items-center justify-center group/h"
            style={{ width: HANDLE_W, cursor: 'ew-resize', touchAction: 'none' }}
            onPointerDown={e => startBarDrag(e, 'resize-start', a)}
            onPointerMove={e => onBarPointerMove(e, a.id)}
            onPointerUp={e => onBarPointerUp(e, a)}
          >
            <div className="w-0.5 h-4 rounded-full opacity-40 group-hover/h:opacity-90 transition"
                 style={{ backgroundColor: clrs.border }} />
          </div>
        )}

        {/* Content */}
        <div
          className="flex items-center gap-1.5 min-w-0 flex-1 pointer-events-none"
          style={{
            paddingLeft:  geo.clippedLeft  ? 8 : HANDLE_W + 4,
            paddingRight: geo.clippedRight ? 4 : HANDLE_W + 4,
          }}
        >
          <span className="text-[11px] font-semibold truncate flex-1" style={{ color: clrs.text }}>
            {a.title}
          </span>
          {asns.length > 0 && geo.width > 90 && <AvatarGroup users={asns} max={2} />}
        </div>

        {/* Right resize handle */}
        {!geo.clippedRight && (
          <div
            data-handle="right"
            className="absolute right-0 top-0 bottom-0 z-10 flex items-center justify-center group/h"
            style={{ width: HANDLE_W, cursor: 'ew-resize', touchAction: 'none' }}
            onPointerDown={e => startBarDrag(e, 'resize-end', a)}
            onPointerMove={e => onBarPointerMove(e, a.id)}
            onPointerUp={e => onBarPointerUp(e, a)}
          >
            <div className="w-0.5 h-4 rounded-full opacity-40 group-hover/h:opacity-90 transition"
                 style={{ backgroundColor: clrs.border }} />
          </div>
        )}
      </div>
    )
  }

  // ── Render row ────────────────────────────────────────────────────────

  function renderRow(a: Activity) {
    const camp = campMap[a.campaign_id]
    return (
      <div key={a.id} className="flex border-b border-gray-50 last:border-0" style={{ height: ROW_H }}>
        {/* Sidebar info */}
        <div className="shrink-0 border-r border-gray-100 px-3 flex flex-col justify-center" style={{ width: SIDEBAR_W }}>
          <span className="text-[10px] text-gray-400 truncate">{camp?.client} › {camp?.name}</span>
          <Link
            href={`/${orgSlug}/workspaces/${camp?.workspaceId}/campaigns/${a.campaign_id}/activities/${a.id}`}
            className="text-xs text-gray-700 font-medium hover:text-indigo-600 transition truncate block"
          >
            {a.title}
          </Link>
        </div>

        {/* Calendar area */}
        <div className="relative flex-1">
          {days.map((day, i) => isWeekend(day) && (
            <div key={i} className="absolute inset-y-0 bg-gray-50/70 pointer-events-none"
                 style={{ left: i * DAY_W, width: DAY_W }} />
          ))}
          {todayIdx >= 0 && (
            <div className="absolute inset-y-0 w-px bg-red-400 pointer-events-none z-20"
                 style={{ left: todayIdx * DAY_W + DAY_W / 2 }} />
          )}
          {renderBar(a)}
        </div>
      </div>
    )
  }

  // ── Full render ───────────────────────────────────────────────────────

  return (
    <div className="p-6 flex flex-col" style={{ height: 'calc(100vh - 2rem)', userSelect: drag ? 'none' : 'auto' }}>

      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Gantt por responsável</h1>
          <p className="text-gray-500 text-sm">{filtered.length} atividade{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { const d = new Date(); d.setDate(d.getDate() - 7); setViewStart(d) }}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition font-medium text-gray-700">
            Hoje
          </button>
          <button onClick={() => setViewStart(d => addDays(d, -7))}
            className="p-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
            <ChevronLeft className="w-4 h-4 text-gray-600" />
          </button>
          <button onClick={() => setViewStart(d => addDays(d, 7))}
            className="p-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 shrink-0 flex-wrap">
        <select value={filterWorkspace} onChange={e => setFilterWorkspace(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400">
          <option value="">Todos os clientes</option>
          {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select value={filterPerson} onChange={e => setFilterPerson(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400">
          <option value="">Todas as pessoas</option>
          {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name ?? '?'}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400">
          <option value="">Todos os status</option>
          {STATUS_CONFIG.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {(filterWorkspace || filterPerson || filterStatus) && (
          <button onClick={() => { setFilterWorkspace(''); setFilterPerson(''); setFilterStatus('') }}
            className="text-xs text-gray-400 hover:text-gray-600 transition px-2 py-1.5">
            Limpar filtros
          </button>
        )}
      </div>

      {/* Gantt table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-auto flex-1">

        {/* Calendar header — drag to scrub timeline */}
        <div className="flex border-b border-gray-200 sticky top-0 bg-white z-30">
          <div className="shrink-0 border-r border-gray-200 flex items-center px-4" style={{ width: SIDEBAR_W }}>
            <span className="text-xs text-gray-400 font-medium select-none">
              {viewStart.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
            </span>
          </div>
          {/* Draggable date strip */}
          <div
            className="flex"
            style={{ cursor: calRef.current ? 'grabbing' : 'grab', touchAction: 'none' }}
            onPointerDown={onCalPointerDown}
            onPointerMove={onCalPointerMove}
            onPointerUp={onCalPointerUp}
            onPointerCancel={() => { calRef.current = null }}
            title="Arraste: ← passado | futuro →"
          >
            {days.map((day, i) => (
              <div key={i}
                className={cn(
                  'flex flex-col items-center justify-center text-xs border-r border-gray-100 shrink-0 py-2 select-none',
                  isToday(day)   ? 'bg-indigo-600 text-white'
                  : isWeekend(day) ? 'bg-gray-50 text-gray-400'
                  : 'text-gray-600'
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

        {/* Groups by assignee */}
        {groups.map(({ profile, activities: ga }) => (
          <div key={profile.id} className="border-b border-gray-100 last:border-0">
            <div className="flex items-center gap-2.5 px-4 py-2.5 bg-gray-50/60 border-b border-gray-100">
              <Avatar name={profile.full_name} avatarUrl={profile.avatar_url} size="sm" />
              <span className="text-sm font-semibold text-gray-800">{profile.full_name ?? '?'}</span>
              <span className="text-xs text-gray-400">{ga.length} tarefa{ga.length !== 1 ? 's' : ''}</span>
            </div>
            {ga.map(a => renderRow(a))}
          </div>
        ))}

        {unassigned.length > 0 && (
          <div className="border-t border-gray-100">
            <div className="flex items-center gap-2.5 px-4 py-2.5 bg-gray-50/60 border-b border-gray-100">
              <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs text-gray-500 shrink-0">—</div>
              <span className="text-sm font-semibold text-gray-500">Sem responsável</span>
              <span className="text-xs text-gray-400">{unassigned.length}</span>
            </div>
            {unassigned.map(a => renderRow(a))}
          </div>
        )}

        {filtered.length === 0 && (
          <div className="text-center py-20 text-gray-400 text-sm">Nenhuma atividade encontrada.</div>
        )}
      </div>
    </div>
  )
}
