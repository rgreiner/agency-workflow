'use client'

/**
 * Painel "Minhas tarefas" da Caixa de entrada: as tarefas em que sou responsável,
 * agrupadas por prazo (Hoje · Em atraso · Próximas · Sem prazo · Concluídas) —
 * o que fazer e o que passou, num relance. A bolinha usa a cor do status (org).
 */
import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, ListChecks } from 'lucide-react'
import { cn, formatDate } from '@/lib/utils'

export interface MyTask {
  id: string
  title: string
  status: string
  statusLabel: string
  statusColor: string
  dueDate: string | null
  href: string
}

type GroupKey = 'hoje' | 'atraso' | 'proximas' | 'semprazo' | 'concluidas'

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }

const GROUPS: { key: GroupKey; label: string; tone?: string }[] = [
  { key: 'atraso', label: 'Em atraso', tone: 'text-red-600' },
  { key: 'hoje', label: 'Hoje' },
  { key: 'proximas', label: 'Próximas' },
  { key: 'semprazo', label: 'Sem prazo' },
  { key: 'concluidas', label: 'Concluídas' },
]

// Versionar a chave quando os defaults mudarem (pref. de view por usuário).
const STORAGE_KEY = 'flow:inbox-mytasks-collapsed:v1'
const DEFAULT_COLLAPSED: Record<GroupKey, boolean> = {
  atraso: false, hoje: false, proximas: false, semprazo: true, concluidas: true,
}

export function MyTasksPanel({ tasks }: { tasks: MyTask[] }) {
  const [mounted, setMounted] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<GroupKey, boolean>>(DEFAULT_COLLAPSED)

  // Recupera os grupos recolhidos salvos por este usuário (localStorage).
  useEffect(() => {
    setMounted(true)
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setCollapsed({ ...DEFAULT_COLLAPSED, ...JSON.parse(raw) })
    } catch { /* ignora storage indisponível/corrompido */ }
  }, [])

  function toggle(key: GroupKey) {
    setCollapsed(c => {
      const next = { ...c, [key]: !c[key] }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* noop */ }
      return next
    })
  }

  const buckets = useMemo(() => {
    const today0 = startOfDay(new Date())
    const tomorrow0 = new Date(today0); tomorrow0.setDate(today0.getDate() + 1)
    const b: Record<GroupKey, MyTask[]> = { hoje: [], atraso: [], proximas: [], semprazo: [], concluidas: [] }
    for (const t of tasks) {
      if (t.status === 'concluido') { b.concluidas.push(t); continue }
      if (!t.dueDate) { b.semprazo.push(t); continue }
      const due = startOfDay(new Date(t.dueDate))
      if (due < today0) b.atraso.push(t)
      else if (due < tomorrow0) b.hoje.push(t)
      else b.proximas.push(t)
    }
    const asc = (a: MyTask, x: MyTask) => (a.dueDate ?? '').localeCompare(x.dueDate ?? '')
    b.atraso.sort(asc); b.hoje.sort(asc); b.proximas.sort(asc)
    b.concluidas.sort((a, x) => (x.dueDate ?? '').localeCompare(a.dueDate ?? ''))
    return b
  }, [tasks])

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-3 px-1">
        <ListChecks className="w-4 h-4 text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-800">Minhas tarefas</h2>
        <span className="text-xs text-gray-400 ml-auto">{tasks.length}</span>
      </div>

      {!mounted ? (
        <div className="space-y-2">
          {[0, 1, 2].map(i => <div key={i} className="h-8 rounded-lg bg-gray-100 animate-pulse" />)}
        </div>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-gray-400 px-1 py-8 text-center">Nenhuma tarefa atribuída a você.</p>
      ) : (
        <div className="space-y-1">
          {GROUPS.map(({ key, label, tone }) => {
            const list = buckets[key]
            if (!list.length) return null
            const isCollapsed = collapsed[key]
            return (
              <div key={key}>
                <button
                  onClick={() => toggle(key)}
                  className="w-full flex items-center gap-1.5 px-1 py-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700 transition-colors"
                >
                  {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
                  <span className={cn('uppercase tracking-wide', tone)}>{label}</span>
                  <span className="text-gray-400 font-normal">{list.length}</span>
                </button>
                {!isCollapsed && (
                  <div className="mb-1">
                    {list.map(t => <TaskRow key={t.id} task={t} group={key} />)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TaskRow({ task, group }: { task: MyTask; group: GroupKey }) {
  let dateLabel = ''
  const overdue = group === 'atraso'
  if (task.dueDate && group !== 'hoje') {
    dateLabel = formatDate(task.dueDate)
    if (overdue) {
      const days = Math.max(1, Math.round((startOfDay(new Date()).getTime() - startOfDay(new Date(task.dueDate)).getTime()) / 86400000))
      dateLabel = `${dateLabel} · ${days}d`
    }
  }
  return (
    <Link
      href={task.href}
      className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white transition-colors group"
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: task.statusColor }} title={task.statusLabel} />
      <span className="flex-1 min-w-0 text-sm text-gray-700 truncate group-hover:text-gray-900">{task.title}</span>
      {dateLabel && (
        <span className={cn('text-[11px] shrink-0', overdue ? 'text-red-500 font-medium' : 'text-gray-400')}>{dateLabel}</span>
      )}
    </Link>
  )
}
