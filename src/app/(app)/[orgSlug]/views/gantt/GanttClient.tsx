'use client'

import { useState, useRef, useTransition, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Avatar, AvatarGroup } from '@/components/ui/Avatar'
import { MultiSelect } from '@/components/ui/Select'
import { useStatusConfig } from '@/components/ui/StatusBadge'
import { ChevronLeft, ChevronRight, Bookmark, X, CheckSquare } from 'lucide-react'
import { PRIORITY_CONFIG } from '@/types'
import { setViewPrefs } from '@/app/actions/prefs'
import { updateActivityDates } from '@/app/actions/activity'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

// ── Constants ─────────────────────────────────────────────────────────────

const DAY_W    = 44
const ROW_H    = 44
const HANDLE_W = 10
const DAYS     = 35
const SCRUB_PX_PER_DAY = 64   // px de scroll horizontal por dia (menos sensível que a largura do dia)
const SCRUB_MAX_STEP   = 4    // máx. de dias por evento de wheel (tira o overshoot da inércia)


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
  checklist?: { done?: boolean }[] | null
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

type SavedFilter = { id: string; name: string; workspaces: string[]; persons: string[]; statuses: string[]; priorities?: string[] }
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x))
const PRIORITY_OPTIONS = Object.entries(PRIORITY_CONFIG).map(([value, cfg]) => ({ value, label: cfg.label }))

// ── Component ──────────────────────────────────────────────────────────────

export function GanttClient({ activities, campMap, profiles, workspaces, orgSlug, initialWorkspace, dbPrefs }: {
  activities: Activity[]
  campMap: CampMap
  profiles: Profile[]
  workspaces: Workspace[]
  orgSlug: string
  initialWorkspace?: string
  dbPrefs?: Record<string, unknown> | null
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const statusConfig = useStatusConfig()

  // ── View state ────────────────────────────────────────────────────────
  const [viewStart, setViewStart] = useState<Date>(() => {
    const d = new Date(); d.setDate(d.getDate() - 7); return d
  })

  // ── Filters (multi-seleção) ───────────────────────────────────────────
  const [filterWorkspaces, setFilterWorkspaces] = useState<string[]>(initialWorkspace ? [initialWorkspace] : [])
  const [filterPersons,    setFilterPersons]    = useState<string[]>([])
  const [filterStatuses,   setFilterStatuses]   = useState<string[]>([])
  const [filterPriorities, setFilterPriorities] = useState<string[]>([])

  // ── Filtros salvos (favoritos, por org no localStorage) ────────────────
  const SAVED_KEY = `gantt-filtros:${orgSlug}`
  const [saved,    setSaved]    = useState<SavedFilter[]>([])
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const saveRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let next: SavedFilter[] | null = null
    try {
      const dbPresets = dbPrefs?.presets as SavedFilter[] | undefined
      if (dbPresets) next = dbPresets
      else { const s = localStorage.getItem(SAVED_KEY); if (s) next = JSON.parse(s) }
    } catch {}
    if (next) setSaved(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [SAVED_KEY])

  useEffect(() => {
    if (!saveOpen) return
    function onOut(e: MouseEvent) { if (saveRef.current && !saveRef.current.contains(e.target as Node)) setSaveOpen(false) }
    document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [saveOpen])

  function persistSaved(next: SavedFilter[]) {
    setSaved(next)
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(next)) } catch {}
    void setViewPrefs(orgSlug, 'views/gantt', { presets: next })
  }
  function saveCurrentFilter() {
    const name = saveName.trim()
    if (!name) return
    persistSaved([...saved, {
      id: `${Date.now()}`, name,
      workspaces: filterWorkspaces, persons: filterPersons, statuses: filterStatuses, priorities: filterPriorities,
    }])
    setSaveName(''); setSaveOpen(false)
  }
  function applySavedFilter(f: SavedFilter) {
    setFilterWorkspaces(f.workspaces); setFilterPersons(f.persons); setFilterStatuses(f.statuses); setFilterPriorities(f.priorities ?? [])
  }
  function deleteSavedFilter(id: string) { persistSaved(saved.filter(f => f.id !== id)) }
  function isSavedActive(f: SavedFilter) {
    return sameSet(f.workspaces, filterWorkspaces) && sameSet(f.persons, filterPersons) && sameSet(f.statuses, filterStatuses) && sameSet(f.priorities ?? [], filterPriorities)
  }

  const hasFilter = filterWorkspaces.length + filterPersons.length + filterStatuses.length + filterPriorities.length > 0

  // ── Drag state: BOTH a ref (for event handlers) and state (for render) ─
  // The ref is read immediately in event handlers (no stale closure).
  // The state triggers re-renders to update bar positions.
  const dragRef = useRef<DragState | null>(null)
  const [drag,   setDrag] = useState<DragState | null>(null)

  // Calendar scrub — same dual approach
  const calRef = useRef<CalState | null>(null)

  // ── Scroll horizontal (trackpad/mouse) também rola o calendário ─────────
  // Gesto horizontal → muda viewStart (mesma direção do arraste nas datas);
  // gesto vertical continua rolando os grupos. wheel precisa de listener
  // nativo não-passivo p/ poder preventDefault (o do React é passivo).
  const scrollRef  = useRef<HTMLDivElement>(null)
  const wheelAccum = useRef(0)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return  // deixa o scroll vertical passar
      e.preventDefault()
      const dx = e.deltaX * (e.deltaMode === 1 ? 16 : 1)     // normaliza modo "linhas"
      wheelAccum.current += dx
      let steps = Math.trunc(wheelAccum.current / SCRUB_PX_PER_DAY)
      if (steps === 0) return
      steps = Math.max(-SCRUB_MAX_STEP, Math.min(SCRUB_MAX_STEP, steps))  // limita saltos (inércia)
      wheelAccum.current -= steps * SCRUB_PX_PER_DAY
      setViewStart(d => addDays(d, steps))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

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
    const d = dragRef.current
    if (!d || d.activityId !== a.id) return
    ;(e.currentTarget as Element).releasePointerCapture(e.pointerId)

    dragRef.current = null
    setDrag(null)

    // Click (no significant movement) → open activity page
    if (Math.abs(d.deltaX) < 5) {
      const camp = campMap[a.campaign_id]
      router.push(`/${orgSlug}/workspaces/${camp.workspaceId}/campaigns/${a.campaign_id}/activities/${a.id}?from=${encodeURIComponent(`/${orgSlug}/views/gantt`)}`)
      return
    }

    // Drag → compute and save new dates
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
    if (filterStatuses.length && !filterStatuses.includes(a.status)) return false
    const camp = campMap[a.campaign_id]
    if (filterWorkspaces.length && !(camp && filterWorkspaces.includes(camp.workspaceId))) return false
    if (filterPersons.length) {
      const ps = (a.activity_assignees as { profiles: Profile }[])?.map(x => x.profiles) ?? []
      if (!ps.some(p => p && filterPersons.includes(p.id))) return false
    }
    if (filterPriorities.length && !filterPriorities.includes(a.priority)) return false
    return true
  })

  const groupMap: Record<string, { profile: Profile; activities: Activity[] }> = {}
  const unassigned: Activity[] = []
  filtered.forEach(a => {
    const ps = (a.activity_assignees as { profiles: Profile }[])?.map(x => x.profiles).filter(Boolean) ?? []
    if (!ps.length) { unassigned.push(a); return }
    ps.forEach(p => {
      if (!p?.id) return
      // Com filtro de pessoa, só os filtrados viram grupo (foco no volume de
      // trabalho dela, mesmo que a task tenha outros responsáveis).
      if (filterPersons.length && !filterPersons.includes(p.id)) return
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

    // Cores seguem Configurações → Aparência (fill = bg claro, borda/texto = text)
    const cfg = statusConfig.find(s => s.value === a.status)
    const clrs = cfg
      ? { bg: cfg.bg, border: cfg.text, text: cfg.text }
      : { bg: '#f3f4f6', border: '#9ca3af', text: '#374151' }
    const asns   = (a.activity_assignees as { profiles: Profile }[])?.map(x => x.profiles).filter(Boolean) ?? []
    const active = drag?.activityId === a.id

    return (
      <div
        className="absolute top-1 bottom-1 rounded-xl flex items-center overflow-hidden select-none"
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
          className="flex items-center gap-2 min-w-0 flex-1 pointer-events-none"
          style={{
            paddingLeft:  geo.clippedLeft  ? 8 : HANDLE_W + 4,
            paddingRight: geo.clippedRight ? 4 : HANDLE_W + 4,
          }}
        >
          <div className="flex flex-col justify-center min-w-0 flex-1">
            <span className="text-[10px] truncate leading-tight" style={{ color: clrs.text, opacity: 0.7 }}>
              {campMap[a.campaign_id]?.client} › {campMap[a.campaign_id]?.name}
            </span>
            <span className="text-xs font-semibold truncate leading-tight" style={{ color: clrs.text }}>
              {a.title}
            </span>
          </div>
          {(() => {
            const total = a.checklist?.length ?? 0
            if (!total || geo.width <= 90) return null
            const done = a.checklist?.filter(c => c?.done).length ?? 0
            return (
              <span className="text-[10px] font-medium tabular-nums shrink-0 inline-flex items-center gap-0.5" style={{ color: clrs.text, opacity: 0.85 }}>
                <CheckSquare className="w-2.5 h-2.5" /> {done}/{total}
              </span>
            )
          })()}
          {asns.length > 0 && geo.width > 120 && <AvatarGroup users={asns} max={2} />}
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
    return (
      <div key={a.id} className="relative border-b border-gray-50 last:border-0" style={{ height: ROW_H }}>
        {days.map((day, i) => isWeekend(day) && (
          <div key={i} className="absolute inset-y-0 bg-gray-50/60 pointer-events-none"
               style={{ left: i * DAY_W, width: DAY_W }} />
        ))}
        {todayIdx >= 0 && (
          <div className="absolute inset-y-0 w-px bg-red-400 pointer-events-none z-20"
               style={{ left: todayIdx * DAY_W + DAY_W / 2 }} />
        )}
        {renderBar(a)}
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
            className="px-3 py-1.5 text-sm bg-gray-100 border border-transparent rounded-xl hover:bg-gray-50 transition font-medium text-gray-700">
            Hoje
          </button>
          <button onClick={() => setViewStart(d => addDays(d, -7))}
            className="p-1.5 bg-gray-100 border border-transparent rounded-xl hover:bg-gray-50 transition">
            <ChevronLeft className="w-4 h-4 text-gray-600" />
          </button>
          <button onClick={() => setViewStart(d => addDays(d, 7))}
            className="p-1.5 bg-gray-100 border border-transparent rounded-xl hover:bg-gray-50 transition">
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 shrink-0 flex-wrap">
        <MultiSelect
          values={filterWorkspaces}
          onChange={setFilterWorkspaces}
          className="w-44"
          allLabel="Todos os clientes"
          options={workspaces.map(w => ({ value: w.id, label: w.name }))}
        />
        <MultiSelect
          values={filterPersons}
          onChange={setFilterPersons}
          className="w-44"
          allLabel="Todas as pessoas"
          options={profiles.map(p => ({ value: p.id, label: p.full_name ?? '?' }))}
        />
        <MultiSelect
          values={filterStatuses}
          onChange={setFilterStatuses}
          className="w-44"
          allLabel="Todos os status"
          options={statusConfig.map(s => ({ value: s.value, label: s.label }))}
        />
        <MultiSelect
          values={filterPriorities}
          onChange={setFilterPriorities}
          className="w-40"
          allLabel="Toda prioridade"
          options={PRIORITY_OPTIONS}
        />
        {hasFilter && (
          <button onClick={() => { setFilterWorkspaces([]); setFilterPersons([]); setFilterStatuses([]); setFilterPriorities([]) }}
            className="text-xs text-gray-400 hover:text-gray-600 transition px-2 py-1.5">
            Limpar filtros
          </button>
        )}

        {/* Salvar filtro atual */}
        <div className="relative" ref={saveRef}>
          <button
            type="button"
            onClick={() => setSaveOpen(o => !o)}
            disabled={!hasFilter}
            title={hasFilter ? 'Salvar filtro atual' : 'Selecione um filtro para salvar'}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition disabled:opacity-40"
          >
            <Bookmark className="w-3.5 h-3.5" /> Salvar filtro
          </button>
          {saveOpen && (
            <div className="pop-in absolute left-0 top-full mt-1.5 z-50 w-56 bg-white rounded-xl border border-gray-200 shadow-lg p-2">
              <input
                autoFocus
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveCurrentFilter(); if (e.key === 'Escape') setSaveOpen(false) }}
                placeholder="Nome do filtro"
                className="w-full px-2.5 py-1.5 bg-gray-100 border border-transparent rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              <div className="flex justify-end gap-2 mt-2">
                <button type="button" onClick={() => { setSaveOpen(false); setSaveName('') }}
                  className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1">Cancelar</button>
                <button type="button" onClick={saveCurrentFilter} disabled={!saveName.trim()}
                  className="text-xs font-medium px-3 py-1 rounded-lg bg-orange-600 text-[#fff] hover:bg-orange-700 disabled:opacity-50 transition">Salvar</button>
              </div>
            </div>
          )}
        </div>

        {/* Filtros salvos (chips) */}
        {saved.length > 0 && <div className="w-px h-5 bg-gray-200" />}
        {saved.map(f => (
          <span key={f.id}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border pl-3 pr-1 py-1 text-xs transition',
              isSavedActive(f) ? 'border-orange-300 bg-orange-50 text-orange-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            )}>
            <button type="button" onClick={() => applySavedFilter(f)} className="max-w-[140px] truncate" title={f.name}>{f.name}</button>
            <button type="button" onClick={() => deleteSavedFilter(f.id)} title="Excluir filtro"
              className="p-0.5 rounded-full text-gray-300 hover:text-red-500 hover:bg-white transition">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>

      {/* Gantt table — overscroll-x-none evita o gesto "voltar página" do trackpad */}
      <div ref={scrollRef} className="bg-white rounded-xl border border-gray-200 overflow-auto overscroll-x-none flex-1">

        {/* Calendar header — sticky, two rows: months + days */}
        <div className="sticky top-0 bg-white z-30 border-b border-gray-200">

          {/* Month labels row */}
          <div className="relative h-6 border-b border-gray-100 select-none">
            {days.map((day, i) => {
              const showMonth = i === 0 || day.getDate() === 1
              if (!showMonth) return null
              return (
                <span key={i} className="absolute top-0 bottom-0 flex items-center px-2 text-[11px] font-semibold text-gray-500"
                      style={{ left: i * DAY_W }}>
                  {day.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                </span>
              )
            })}
          </div>

          {/* Day numbers — draggable to scrub */}
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
                  'flex flex-col items-center justify-center text-xs border-r border-gray-100 shrink-0 py-1.5 select-none',
                  isToday(day)    ? 'bg-orange-600 text-[#fff]'
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
            {/* Group header — sticky left so name stays visible when scrolling */}
            <div className="sticky left-0 z-20 flex items-center gap-2.5 px-4 py-2 bg-gray-50/90 border-b border-gray-100 backdrop-blur-sm">
              <Avatar name={profile.full_name} avatarUrl={profile.avatar_url} size="sm" />
              <span className="text-sm font-semibold text-gray-800">{profile.full_name ?? '?'}</span>
              <span className="text-xs text-gray-400">{ga.length} tarefa{ga.length !== 1 ? 's' : ''}</span>
            </div>
            {ga.map(a => renderRow(a))}
          </div>
        ))}

        {unassigned.length > 0 && (
          <div className="border-t border-gray-100">
            <div className="sticky left-0 z-20 flex items-center gap-2.5 px-4 py-2 bg-gray-50/90 border-b border-gray-100 backdrop-blur-sm">
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
