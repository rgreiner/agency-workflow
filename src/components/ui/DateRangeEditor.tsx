'use client'

import { useState, useTransition, useRef, useEffect, useCallback } from 'react'
import { Calendar, ArrowRight, Loader2, ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react'
import { updateActivityDates, updateActivityField } from '@/app/actions/activity'
import { formatDate, isOverdue, daysUntil, cn } from '@/lib/utils'
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
  /** Modo enxuto p/ a Lista: gatilho = badge do prazo (Xd / atraso / + prazo). */
  compact?: boolean
}

// ── Component ─────────────────────────────────────────────────────────────

export function DateRangeEditor({ activityId, path, startDate, dueDate, canEdit, compact = false }: Props) {
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
    if (compact) {
      const days = daysUntil(localEnd || null)
      return (
        <span className={cn('text-xs font-medium flex items-center gap-1',
          overdue ? 'text-red-600' : days !== null && days <= 3 ? 'text-orange-500' : 'text-gray-600')}>
          {localEnd
            ? <>{overdue && <AlertCircle className="w-3 h-3 shrink-0" />}
                {overdue ? `${Math.abs(days!)}d atraso` : days === 0 ? 'Hoje' : days === 1 ? 'Amanhã' : `${days}d`}</>
            : <span className="text-gray-300">—</span>}
        </span>
      )
    }
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

  // Gatilho compacto (Lista): badge do prazo, igual às outras colunas.
  const compactDays = daysUntil(localEnd || null)
  const trigger = compact ? (
    <button
      type="button"
      title="Definir período (início → prazo)"
      onClick={(e) => { e.stopPropagation(); setPhase('start'); setOpen(o => !o) }}
      className="flex items-center gap-1 text-left"
    >
      {localEnd ? (
        <span className={cn('text-xs font-medium flex items-center gap-1',
          overdue ? 'text-red-600' : compactDays !== null && compactDays <= 3 ? 'text-orange-500' : 'text-gray-600')}>
          {overdue && <AlertCircle className="w-3 h-3 shrink-0" />}
          {overdue ? `${Math.abs(compactDays!)}d atraso` : compactDays === 0 ? 'Hoje' : compactDays === 1 ? 'Amanhã' : `${compactDays}d`}
        </span>
      ) : <span className="text-xs text-gray-300 hover:text-orange-500 transition">+ prazo</span>}
      {isPending && <Loader2 className="w-3 h-3 text-orange-500 animate-spin shrink-0" />}
    </button>
  ) : (
    <button
      type="button"
      onClick={() => { setPhase('start'); setOpen(o => !o) }}
      className="flex items-center gap-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 hover:border-orange-300 hover:bg-orange-50 transition"
    >
      <Calendar className="w-3.5 h-3.5 text-gray-400 shrink-0" />
      <span className={cn(localStart || localEnd ? 'text-gray-700' : 'text-gray-400')}>
        {triggerLabel}
      </span>
      {isPending && <Loader2 className="w-3 h-3 text-orange-500 animate-spin shrink-0" />}
    </button>
  )

  return (
    <div className="relative">
      {trigger}

      {/* Calendar popup */}
      {open && (
        <div
          ref={popupRef}
          onClick={(e) => e.stopPropagation()}
          className="pop-in absolute top-full left-0 mt-1 z-50 bg-white rounded-2xl border border-gray-200 shadow-xl p-4"
          style={{ minWidth: 300 }}
        >
          {/* Hint */}
          <p className="text-xs text-gray-400 text-center mb-3">
            {phase === 'start' ? 'Clique para definir o início' : 'Clique para definir o fim'}
          </p>

          {/* Month nav */}
          <div className="flex items-center justify-between mb-3">
            <button type="button" onClick={prevMonth} aria-label="Mês anterior"
              className="p-1.5 rounded-lg hover:bg-gray-100 transition text-gray-500">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold text-gray-800">
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button type="button" onClick={nextMonth} aria-label="Próximo mês"
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
                  isMid   && 'bg-orange-50',
                  isStart && !isSingle && 'bg-gradient-to-r from-transparent to-orange-50',
                  isEnd   && !isSingle && 'bg-gradient-to-l from-transparent to-orange-50',
                )}>
                  <button
                    type="button"
                    onClick={() => handleDayClick(ymd)}
                    onMouseEnter={() => phase === 'end' && setHovered(ymd)}
                    onMouseLeave={() => setHovered(null)}
                    className={cn(
                      'w-8 h-8 rounded-full text-sm transition flex items-center justify-center font-medium z-10 relative',
                      isSelected ? 'bg-orange-600 text-[#fff]'
                      : isToday  ? 'ring-2 ring-orange-400 text-orange-600'
                      : isMid    ? 'text-orange-700 hover:bg-orange-100'
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
