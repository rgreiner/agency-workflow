'use client'

import { useState, useRef, useEffect } from 'react'
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── helpers ────────────────────────────────────────────────────────────────

const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
const WEEK_SHORT = ['Do','2ª','3ª','4ª','5ª','6ª','Sá']

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function todayYMD() { return toYMD(new Date()) }

function fmtShort(ymd: string) {
  const [y, m, d] = ymd.split('-')
  return `${d}/${m}/${String(y).slice(2)}`
}

function buildCalendarDays(year: number, month: number) {
  const first = new Date(year, month, 1).getDay()
  const total = new Date(year, month + 1, 0).getDate()
  const cells: (string | null)[] = []
  for (let i = 0; i < first; i++) cells.push(null)
  for (let d = 1; d <= total; d++) {
    cells.push(`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`)
  }
  while (cells.length % 7) cells.push(null)
  return cells
}

// ── types ──────────────────────────────────────────────────────────────────

interface Props {
  startDate: string      // YYYY-MM-DD or ''
  endDate:   string      // YYYY-MM-DD or ''
  onStartChange: (v: string) => void
  onEndChange:   (v: string) => void
  label?: string
  placeholder?: string
}

// ── component ──────────────────────────────────────────────────────────────

export function DatePicker({ startDate, endDate, onStartChange, onEndChange, label, placeholder = 'Definir período' }: Props) {
  const today    = todayYMD()
  const initDate = startDate ? new Date(startDate + 'T00:00') : new Date()

  const [open,      setOpen]      = useState(false)
  const [hovered,   setHovered]   = useState<string | null>(null)
  const [viewYear,  setViewYear]  = useState(initDate.getFullYear())
  const [viewMonth, setViewMonth] = useState(initDate.getMonth())

  // 'start' = next click sets start | 'end' = next click sets end
  const [phase, setPhase] = useState<'start' | 'end'>(startDate && !endDate ? 'end' : 'start')

  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onOut(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setHovered(null)
      }
    }
    document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [])

  // Compute effective range for highlighting (includes hover preview)
  const previewEnd   = phase === 'end' && hovered ? hovered : endDate
  const rangeStart   = startDate
  const rangeEnd     = previewEnd && startDate ? (previewEnd >= startDate ? previewEnd : startDate) : ''
  const rangeStartEff = rangeStart && rangeEnd ? (rangeStart <= rangeEnd ? rangeStart : rangeEnd) : ''
  const rangeEndEff   = rangeStart && rangeEnd ? (rangeStart <= rangeEnd ? rangeEnd   : rangeStart) : ''

  function handleDayClick(ymd: string) {
    if (phase === 'start') {
      onStartChange(ymd)
      onEndChange('')
      setPhase('end')
    } else {
      // second click
      if (ymd === startDate) {
        // same day → single-day range
        onEndChange(ymd)
        setPhase('start')
        setOpen(false)
        setHovered(null)
      } else if (ymd < startDate) {
        // clicked before start → swap: new start
        onStartChange(ymd)
        onEndChange(startDate)
        setPhase('start')
        setOpen(false)
        setHovered(null)
      } else {
        onEndChange(ymd)
        setPhase('start')
        setOpen(false)
        setHovered(null)
      }
    }
  }

  function clearDates(e: React.MouseEvent) {
    e.stopPropagation()
    onStartChange('')
    onEndChange('')
    setPhase('start')
    setHovered(null)
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  const cells = buildCalendarDays(viewYear, viewMonth)

  // Trigger label
  const triggerText = startDate && endDate
    ? `${fmtShort(startDate)} → ${fmtShort(endDate)}`
    : startDate
    ? `${fmtShort(startDate)} → …`
    : ''

  return (
    <div className="relative" ref={ref}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      )}

      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          'w-full flex items-center gap-2.5 px-4 py-3 border rounded-xl text-sm transition text-left',
          'focus:outline-none',
          open ? 'border-indigo-400 ring-2 ring-indigo-500' : 'border-gray-300 hover:border-gray-400',
          triggerText ? 'text-gray-900' : 'text-gray-400'
        )}
      >
        <Calendar className="w-4 h-4 text-gray-400 shrink-0" />
        <span className="flex-1">{triggerText || placeholder}</span>
        {(startDate || endDate) && (
          <button type="button" onClick={clearDates}
            className="text-gray-300 hover:text-gray-500 transition">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </button>

      {/* Calendar popup */}
      {open && (
        <div className="absolute z-50 mt-1 left-0 bg-white rounded-2xl border border-gray-200 shadow-xl p-4"
             style={{ minWidth: 300 }}>

          {/* Hint */}
          <p className="text-xs text-gray-400 text-center mb-3">
            {phase === 'start' ? 'Clique para definir o início' : 'Clique para definir o fim'}
          </p>

          {/* Month navigation */}
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
                <div
                  key={ymd}
                  className={cn(
                    'relative h-9 flex items-center justify-center',
                    // range background strip (middle days)
                    isMid   && 'bg-indigo-50',
                    isStart && !isSingle && 'bg-gradient-to-r from-transparent to-indigo-50',
                    isEnd   && !isSingle && 'bg-gradient-to-l from-transparent to-indigo-50',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => handleDayClick(ymd)}
                    onMouseEnter={() => phase === 'end' && setHovered(ymd)}
                    onMouseLeave={() => setHovered(null)}
                    className={cn(
                      'w-8 h-8 rounded-full text-sm transition flex items-center justify-center font-medium z-10 relative',
                      isSelected
                        ? 'bg-indigo-600 text-white'
                        : isToday
                        ? 'ring-2 ring-indigo-400 text-indigo-600'
                        : isMid
                        ? 'text-indigo-700 hover:bg-indigo-100'
                        : 'text-gray-700 hover:bg-gray-100'
                    )}
                  >
                    {Number(ymd.split('-')[2])}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
