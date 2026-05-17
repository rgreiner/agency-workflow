'use client'

import { useState, useTransition, useRef, useEffect, useCallback } from 'react'
import { Calendar, ArrowRight, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import { updateActivityDates } from '@/app/actions/activity'
import { updateActivityField } from '@/app/actions/activity'
import { formatDate, isOverdue, cn } from '@/lib/utils'
import { toast } from 'sonner'

// ── Calendar helpers ──────────────────────────────────────────────────────
const MONTHS     = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
const WEEK_SHORT = ['Do','2ª','3ª','4ª','5ª','6ª','Sá']

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function todayYMD() { return toYMD(new Date()) }

// Normalize date strings — handle both YYYY-MM-DD and ISO timestamps
function normDate(v: string | null | undefined): string {
  if (!v) return ''
  return v.slice(0, 10)
}

function buildCalendarDays(year: number, month: number) {
  const first = new Date(year, month, 1).getDay()
  const total = new Date(year, month + 1, 0).getDate()
  const cells: (string | null)[] = []
  for (let i = 0; i < first; i++) cells.push(null)
  for (let d = 1; d <= total; d++)
    cells.push(`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`)
  while (cells.length % 7) cells.push(null)
  return cells
}

function fmtDisplay(ymd: string) {
  if (!ymd) return ''
  const clean = ymd.slice(0, 10)
  const [y, m, d] = clean.split('-')
  return `${d}/${m}/${String(y).slice(2)}`
}

// ── Props ─────────────────────────────────────────────────────────────────

interface Props {
  activityId: string
  path: string
  startDate: string | null
  dueDate: string | null
  canEdit: boolean
}

// ── Component ─────────────────────────────────────────────────────────────

export function DateRangeEditor({ activityId, path, startDate, dueDate, canEdit }: Props) {
  // Normalize server values
  const origStart = normDate(startDate)
  const origEnd   = normDate(dueDate)

  // Local editing state
  const [localStart, setLocalStart] = useState(origStart)
  const [localEnd,   setLocalEnd]   = useState(origEnd)

  // Keep refs in sync for use inside event handlers (stale closure guard)
  const localStartRef = useRef(origStart)
  const localEndRef   = useRef(origEnd)

  const [open,  setOpen]  = useState(false)
  const [phase, setPhase] = useState<'start' | 'end'>('start')
  const [hovered, setHovered] = useState<string | null>(null)

  const [isPending, startTransition] = useTransition()
  const popupRef = useRef<HTMLDivElement>(null)

  const today = todayYMD()
  const initDate = origStart ? new Date(origStart + 'T00:00') : new Date()
  const [viewYear,  setViewYear]  = useState(initDate.getFullYear())
  const [viewMonth, setViewMonth] = useState(initDate.getMonth())

  // Sync state when server props update (after revalidation)
  useEffect(() => {
    const ns = normDate(startDate)
    const ne = normDate(dueDate)
    setLocalStart(ns); localStartRef.current = ns
    setLocalEnd(ne);   localEndRef.current   = ne
  }, [startDate, dueDate])

  const overdue = isOverdue(localEnd || null)

  // ── Save logic ──────────────────────────────────────────────────────────
  // Only saves what actually changed vs. server values

  const saveChanges = useCallback((ns: string, ne: string) => {
    const startChanged = ns !== origStart
    const endChanged   = ne !== origEnd
    if (!startChanged && !endChanged) return

    startTransition(async () => {
      let result
      if (startChanged && endChanged) {
        result = await updateActivityDates(activityId, ns || null, ne || null)
      } else if (startChanged) {
        result = await updateActivityField(path, activityId, 'start_date', ns || null)
      } else {
        result = await updateActivityField(path, activityId, 'due_date', ne || null)
      }
      if (result?.error) toast.error(result.error)
    })
  }, [activityId, path, origStart, origEnd]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close popup and save whatever changed
  const closeAndSave = useCallback(() => {
    setOpen(false)
    setHovered(null)
    saveChanges(localStartRef.current, localEndRef.current)
  }, [saveChanges])

  // Click-outside handler
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        closeAndSave()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, closeAndSave])

  // ── Day click logic ─────────────────────────────────────────────────────

  function handleDayClick(ymd: string) {
    if (phase === 'start') {
      // Set start — do NOT clear end (preserve it for smart save)
      setLocalStart(ymd); localStartRef.current = ymd
      setPhase('end')
      setHovered(null)
    } else {
      // Set end
      let finalStart = localStartRef.current
      let finalEnd   = ymd

      // If clicked before start → swap
      if (finalStart && finalEnd < finalStart) {
        [finalStart, finalEnd] = [finalEnd, finalStart]
      }

      setLocalStart(finalStart); localStartRef.current = finalStart
      setLocalEnd(finalEnd);     localEndRef.current   = finalEnd
      setPhase('start')
      setOpen(false)
      setHovered(null)
      saveChanges(finalStart, finalEnd)
    }
  }

  // ── Calendar navigation ─────────────────────────────────────────────────

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  // ── Range highlighting ──────────────────────────────────────────────────

  const previewEnd    = phase === 'end' && hovered ? hovered : localEnd
  const rangeS        = localStart
  const rangeE        = previewEnd && localStart ? (previewEnd >= localStart ? previewEnd : localStart) : ''
  const rangeStartEff = rangeS && rangeE ? (rangeS <= rangeE ? rangeS : rangeE) : ''
  const rangeEndEff   = rangeS && rangeE ? (rangeS <= rangeE ? rangeE : rangeS) : ''

  const cells = buildCalendarDays(viewYear, viewMonth)

  // ── Render ──────────────────────────────────────────────────────────────

  const triggerLabel = localStart || localEnd
    ? `${localStart ? fmtDisplay(localStart) : 'Início'} → ${localEnd ? fmtDisplay(localEnd) : 'Prazo'}`
    : 'Definir datas'

  if (!canEdit) {
    return (
      <div className="flex items-center gap-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
        <Calendar className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span className="text-gray-600">{localStart ? formatDate(localStart) : '—'}</span>
        <ArrowRight className="w-3 h-3 text-gray-400" />
        <span className={cn(overdue ? 'text-red-600 font-medium' : 'text-gray-600')}>
          {localEnd ? formatDate(localEnd) : '—'}
        </span>
      </div>
    )
  }

  return (
    <div className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => { setPhase('start'); setOpen(o => !o) }}
        className="flex items-center gap-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 hover:border-indigo-300 hover:bg-indigo-50 transition"
      >
        <Calendar className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span className={cn(localStart || localEnd ? 'text-gray-700' : 'text-gray-400')}>
          {triggerLabel}
        </span>
        {isPending && <Loader2 className="w-3 h-3 text-indigo-500 animate-spin shrink-0" />}
      </button>

      {/* Calendar popup */}
      {open && (
        <div
          ref={popupRef}
          className="absolute top-full left-0 mt-1 z-50 bg-white rounded-2xl border border-gray-200 shadow-xl p-4"
          style={{ minWidth: 300 }}
        >
          {/* Hint */}
          <p className="text-xs text-gray-400 text-center mb-3">
            {phase === 'start' ? 'Clique para definir o início' : 'Clique para definir o fim'}
          </p>

          {/* Month nav */}
          <div className="flex items-center justify-between mb-3">
            <button type="button" onClick={prevMonth}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition text-gray-500">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold text-gray-800">
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button type="button" onClick={nextMonth}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition text-gray-500">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 mb-1">
            {WEEK_SHORT.map(w => (
              <div key={w} className="text-center text-[11px] font-medium text-gray-400 py-1">{w}</div>
            ))}
          </div>

          {/* Days grid */}
          <div className="grid grid-cols-7">
            {cells.map((ymd, i) => {
              if (!ymd) return <div key={i} />
              const isToday    = ymd === today
              const isStart    = ymd === rangeStartEff
              const isEnd      = ymd === rangeEndEff
              const isMid      = !!rangeStartEff && !!rangeEndEff && ymd > rangeStartEff && ymd < rangeEndEff
              const isSingle   = isStart && isEnd
              const isSelected = isStart || isEnd
              return (
                <div key={ymd} className={cn(
                  'relative h-9 flex items-center justify-center',
                  isMid   && 'bg-indigo-50',
                  isStart && !isSingle && 'bg-gradient-to-r from-transparent to-indigo-50',
                  isEnd   && !isSingle && 'bg-gradient-to-l from-transparent to-indigo-50',
                )}>
                  <button
                    type="button"
                    onClick={() => handleDayClick(ymd)}
                    onMouseEnter={() => phase === 'end' && setHovered(ymd)}
                    onMouseLeave={() => setHovered(null)}
                    className={cn(
                      'w-8 h-8 rounded-full text-sm transition flex items-center justify-center font-medium z-10 relative',
                      isSelected ? 'bg-indigo-600 text-white'
                      : isToday  ? 'ring-2 ring-indigo-400 text-indigo-600'
                      : isMid    ? 'text-indigo-700 hover:bg-indigo-100'
                      : 'text-gray-700 hover:bg-gray-100'
                    )}
                  >
                    {Number(ymd.split('-')[2])}
                  </button>
                </div>
              )
            })}
          </div>

          {/* Clear */}
          {(localStart || localEnd) && (
            <div className="mt-3 border-t border-gray-100 pt-3 text-center">
              <button
                type="button"
                onClick={() => {
                  setLocalStart(''); localStartRef.current = ''
                  setLocalEnd('');   localEndRef.current   = ''
                  setOpen(false)
                  saveChanges('', '')
                }}
                className="text-xs text-gray-400 hover:text-red-500 transition"
              >
                Limpar datas
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
