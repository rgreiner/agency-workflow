'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { Calendar, ArrowRight, Loader2 } from 'lucide-react'
import { DatePicker } from '@/components/ui/DatePicker'
import { updateActivityDates } from '@/app/actions/activity'
import { formatDate, isOverdue, cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Props {
  activityId: string
  startDate: string | null
  dueDate: string | null
  canEdit: boolean
}

export function DateRangeEditor({ activityId, startDate, dueDate, canEdit }: Props) {
  const [start, setStart] = useState(startDate ?? '')
  const [end,   setEnd]   = useState(dueDate ?? '')
  const [open,  setOpen]  = useState(false)
  const [isPending, startTransition] = useTransition()
  const ref = useRef<HTMLDivElement>(null)

  const overdue = isOverdue(end || null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function save(s: string | null, e: string | null) {
    if (s === (startDate ?? null) && e === (dueDate ?? null)) return
    startTransition(async () => {
      const result = await updateActivityDates(activityId, s, e)
      if (result?.error) toast.error(result.error)
    })
  }

  function handleEndChange(v: string) {
    setEnd(v)
    save(start || null, v || null)
    setOpen(false)
  }

  if (!canEdit) {
    return (
      <div className="flex items-center gap-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
        <Calendar className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span className="text-gray-600">{startDate ? formatDate(startDate) : '—'}</span>
        <ArrowRight className="w-3 h-3 text-gray-400" />
        <span className={cn(overdue ? 'text-red-600 font-medium' : 'text-gray-600')}>
          {dueDate ? formatDate(dueDate) : '—'}
        </span>
      </div>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 hover:border-indigo-300 hover:bg-indigo-50 transition"
      >
        <Calendar className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span className="text-gray-600">{start ? formatDate(start) : 'Início'}</span>
        <ArrowRight className="w-3 h-3 text-gray-400" />
        <span className={cn(overdue ? 'text-red-600 font-medium' : 'text-gray-600')}>
          {end ? formatDate(end) : 'Prazo'}
        </span>
        {isPending && <Loader2 className="w-3 h-3 text-indigo-500 animate-spin shrink-0" />}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50">
          <DatePicker
            calendarOnly
            startDate={start}
            endDate={end}
            onStartChange={v => setStart(v)}
            onEndChange={handleEndChange}
          />
        </div>
      )}
    </div>
  )
}
