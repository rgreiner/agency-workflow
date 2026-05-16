'use client'

import { useState, useRef, useEffect } from 'react'
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  value: string        // YYYY-MM-DD ou ''
  onChange: (v: string) => void
  placeholder?: string
  minDate?: string
  label?: string
}

const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
const WEEK   = ['Do','2ª','3ª','4ª','5ª','6ª','Sá']

function toLocalDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function today() { return toYMD(new Date()) }

function addDays(base: Date, n: number) {
  const d = new Date(base); d.setDate(d.getDate() + n); return d
}

function nextWeekday(base: Date, weekday: number) {
  const d = new Date(base)
  const diff = (weekday - d.getDay() + 7) % 7 || 7
  d.setDate(d.getDate() + diff)
  return d
}

function formatDisplay(dateStr: string): string {
  if (!dateStr) return ''
  const d = toLocalDate(dateStr)
  const now = new Date(); now.setHours(0,0,0,0)
  const diff = Math.round((d.getTime() - now.getTime()) / 86400000)
  if (diff === 0)  return 'Hoje'
  if (diff === 1)  return 'Amanhã'
  if (diff === -1) return 'Ontem'
  if (diff < -1)   return `${Math.abs(diff)} dias atrás`
  if (diff < 7)    return `${diff}d`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.','')
}

function buildPresets(minDate?: string) {
  const now = new Date(); now.setHours(0,0,0,0)
  const min = minDate ? toLocalDate(minDate) : null

  function opt(label: string, d: Date) {
    const ymd = toYMD(d)
    const disabled = !!min && d < min
    const dow = ['dom','seg','ter','qua','qui','sex','sáb'][d.getDay()]
    const dateStr = d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.','')
    return { label, value: ymd, disabled, sub: dow === 'hoje' ? '' : `${dow} · ${dateStr}` }
  }

  return [
    { label: 'Hoje',                   value: toYMD(now),               disabled: !!min && now < min, sub: ['dom','seg','ter','qua','qui','sex','sáb'][now.getDay()] },
    opt('Amanhã',                      addDays(now, 1)),
    opt('Semana que vem',              nextWeekday(now, 1)),
    opt('Próximo final de semana',     nextWeekday(now, 5)),
    opt('2 semanas',                   addDays(now, 14)),
    opt('4 semanas',                   addDays(now, 28)),
    opt('8 semanas',                   addDays(now, 56)),
  ]
}

function buildCalendar(year: number, month: number) {
  const first = new Date(year, month, 1)
  const last  = new Date(year, month + 1, 0)
  const startDay = first.getDay()
  const days: (number | null)[] = Array(startDay).fill(null)
  for (let d = 1; d <= last.getDate(); d++) days.push(d)
  while (days.length % 7 !== 0) days.push(null)
  return days
}

export function DatePicker({ value, onChange, placeholder = 'Selecionar data', minDate, label }: Props) {
  const [open, setOpen] = useState(false)
  const now = new Date()
  const [viewYear,  setViewYear]  = useState(value ? toLocalDate(value).getFullYear()  : now.getFullYear())
  const [viewMonth, setViewMonth] = useState(value ? toLocalDate(value).getMonth()     : now.getMonth())
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onOut(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [])

  function pick(ymd: string) {
    onChange(ymd)
    setOpen(false)
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation()
    onChange('')
  }

  const presets = buildPresets(minDate)
  const days    = buildCalendar(viewYear, viewMonth)
  const todayYMD = today()
  const minYMD   = minDate ?? ''

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y-1) }
    else setViewMonth(m => m-1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y+1) }
    else setViewMonth(m => m+1)
  }

  return (
    <div className="relative" ref={ref}>
      {label && <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>}

      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          'w-full flex items-center gap-2.5 px-4 py-3 border rounded-xl text-sm transition',
          'focus:outline-none focus:ring-2 focus:ring-indigo-500',
          open   ? 'border-indigo-400 ring-2 ring-indigo-500' : 'border-gray-300',
          value  ? 'text-gray-900' : 'text-gray-400'
        )}
      >
        <Calendar className="w-4 h-4 text-gray-400 shrink-0" />
        <span className="flex-1 text-left">{value ? formatDisplay(value) : placeholder}</span>
        {value && (
          <span
            onClick={clear}
            className="text-gray-400 hover:text-gray-600 transition cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </span>
        )}
      </button>

      {/* Popup */}
      {open && (
        <div className="absolute z-50 mt-1 bg-white rounded-2xl border border-gray-200 shadow-xl flex overflow-hidden"
             style={{ minWidth: 520 }}>

          {/* Presets */}
          <div className="w-52 border-r border-gray-100 py-2">
            {presets.map(p => (
              <button
                key={p.value}
                type="button"
                disabled={p.disabled}
                onClick={() => !p.disabled && pick(p.value)}
                className={cn(
                  'w-full flex items-center justify-between px-4 py-2 text-sm transition',
                  p.disabled ? 'text-gray-300 cursor-not-allowed' :
                  value === p.value ? 'bg-indigo-50 text-indigo-700 font-medium' :
                  'text-gray-700 hover:bg-gray-50'
                )}
              >
                <span>{p.label}</span>
                <span className="text-xs text-gray-400">{p.sub}</span>
              </button>
            ))}
          </div>

          {/* Calendar */}
          <div className="p-4">
            {/* Month nav */}
            <div className="flex items-center justify-between mb-3">
              <button type="button" onClick={prevMonth}
                className="p-1 rounded-lg hover:bg-gray-100 transition text-gray-500">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-semibold text-gray-800">
                {MONTHS[viewMonth]} {viewYear}
              </span>
              <button type="button" onClick={nextMonth}
                className="p-1 rounded-lg hover:bg-gray-100 transition text-gray-500">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Weekday headers */}
            <div className="grid grid-cols-7 mb-1">
              {WEEK.map(w => (
                <div key={w} className="text-center text-xs font-medium text-gray-400 py-1">{w}</div>
              ))}
            </div>

            {/* Days */}
            <div className="grid grid-cols-7 gap-y-0.5">
              {days.map((d, i) => {
                if (!d) return <div key={i} />
                const ymd = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
                const isToday    = ymd === todayYMD
                const isSelected = ymd === value
                const isDisabled = !!minYMD && ymd < minYMD

                return (
                  <button
                    key={i}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => !isDisabled && pick(ymd)}
                    className={cn(
                      'w-8 h-8 mx-auto rounded-full text-sm transition flex items-center justify-center',
                      isDisabled  ? 'text-gray-200 cursor-not-allowed' :
                      isSelected  ? 'bg-indigo-600 text-white font-semibold' :
                      isToday     ? 'bg-red-500 text-white font-semibold' :
                      'text-gray-700 hover:bg-indigo-50'
                    )}
                  >
                    {d}
                  </button>
                )
              })}
            </div>

            {/* Hoje shortcut */}
            <button
              type="button"
              onClick={() => pick(todayYMD)}
              className="mt-3 w-full text-center text-xs text-indigo-500 hover:text-indigo-700 transition font-medium"
            >
              Hoje
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
