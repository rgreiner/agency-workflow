'use client'

import { useState, useEffect, useRef, useTransition } from 'react'
import Link from 'next/link'
import { cn, isOverdue, daysUntil } from '@/lib/utils'
import { PRIORITY_CONFIG, COMPLEXITY_CONFIG, type ActivityPriority } from '@/types'
import { AlertCircle, ExternalLink, ChevronDown, Columns3, Check, GripVertical, Plus, Search, Flag, SignalLow, SignalMedium, SignalHigh, Copy, Archive, ArchiveRestore } from 'lucide-react'

// Complexidade → ícone (1/2/3 barras)
const COMPLEXITY_ICON = { simple: SignalLow, medium: SignalMedium, complex: SignalHigh } as const
import { AvatarGroup } from '@/components/ui/Avatar'
import { DateRangeEditor } from '@/components/ui/DateRangeEditor'
import { updateActivityStatus, updateActivityField, setActivityArchived } from '@/app/actions/activity'
import { createClient } from '@/lib/supabase/client'
import { getUsuarioClient } from '@/lib/auth/client'
import { toast } from 'sonner'

// ── Column definitions ────────────────────────────────────────────────────

type ColKey = 'responsavel' | 'prazo' | 'prioridade' | 'complexidade' | 'layout'

const COL_DEFS: { key: ColKey; label: string; defaultOn: boolean; width: string }[] = [
  { key: 'responsavel',  label: 'Responsável',  defaultOn: true,  width: 'w-32' },
  { key: 'prazo',        label: 'Prazo',         defaultOn: true,  width: 'w-24' },
  { key: 'prioridade',   label: 'Prioridade',    defaultOn: true,  width: 'w-20' },
  { key: 'complexidade', label: 'Complexidade',  defaultOn: false, width: 'w-24' },
  { key: 'layout',       label: 'Drive',         defaultOn: true,  width: 'w-28' },
]

const STORAGE_KEY = 'lista-cols-v4'

function defaultCols(): Record<ColKey, boolean> {
  return Object.fromEntries(COL_DEFS.map(c => [c.key, c.defaultOn])) as Record<ColKey, boolean>
}

const defaultOrder = (): ColKey[] => COL_DEFS.map(c => c.key)

// ── Types ─────────────────────────────────────────────────────────────────

interface Assignee { full_name: string | null; avatar_url: string | null }
interface Member { userId: string; fullName: string | null; email: string; avatarUrl: string | null }
interface Activity {
  id: string; title: string; status: string; priority: string
  due_date: string | null; start_date?: string | null; complexity?: string | null
  layout_url: string | null; campaign_id: string; assignees: Assignee[]; assignedIds: string[]
}
interface CampInfo { name: string; client: string; workspaceId: string }
interface Props {
  orgSlug: string
  activities: Activity[]
  campMap: Record<string, CampInfo>
  grouped: Record<string, Activity[]>
  statusConfig: { value: string; label: string; bgColor: string; color: string }[]
  members: Member[]
  initialWorkspace?: string
  view: 'ativas' | 'arquivadas'
}

// ── Component ─────────────────────────────────────────────────────────────

export function ListaClient({ orgSlug, activities, campMap, grouped, statusConfig, members, initialWorkspace, view }: Props) {
  const listPath = `/${orgSlug}/views/lista`
  const isArchivedView = view === 'arquivadas'
  // Otimista: esconde itens recém-(des)arquivados até o revalidate do servidor.
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  function archiveActivity(id: string, title: string) {
    setHidden(prev => new Set(prev).add(id))
    startTransition(async () => {
      const r = await setActivityArchived(listPath, id, !isArchivedView)
      if (r?.error) {
        setHidden(prev => { const n = new Set(prev); n.delete(id); return n })
        toast.error(r.error)
      } else {
        toast.success(isArchivedView ? `"${title}" desarquivada` : `"${title}" arquivada`)
      }
    })
  }
  const [cols, setCols] = useState<Record<ColKey, boolean>>(defaultCols)
  const [order, setOrder] = useState<ColKey[]>(defaultOrder)
  const [dragCol, setDragCol] = useState<ColKey | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [filterWorkspace, setFilterWorkspace] = useState(initialWorkspace ?? '')
  const pickerRef = useRef<HTMLDivElement>(null)

  // ── Drag & drop entre status ──
  // overrides aplicam o novo status otimisticamente até o revalidate do servidor
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [, startTransition] = useTransition()

  // Troca de status (otimista) — usada pelo drag-and-drop E pelo seletor no nome.
  function changeStatus(id: string, targetStatus: string) {
    const activity = activities.find(a => a.id === id)
    const currentStatus = overrides[id] ?? activity?.status
    if (!activity || currentStatus === targetStatus) return

    const previous = overrides[id]
    setOverrides(prev => ({ ...prev, [id]: targetStatus }))

    startTransition(async () => {
      const result = await updateActivityStatus(`/${orgSlug}/views/lista`, id, targetStatus, '')
      if (result?.error) {
        // rollback do update otimista
        setOverrides(prev => {
          const next = { ...prev }
          if (previous) next[id] = previous
          else delete next[id]
          return next
        })
        toast.error(result.error)
      } else {
        const label = statusConfig.find(s => s.value === targetStatus)?.label ?? targetStatus
        toast.success(`"${activity.title}" movida para ${label}`)
      }
    })
  }

  function handleDrop(targetStatus: string) {
    const id = draggingId
    setDraggingId(null)
    setDragOverStatus(null)
    if (id) changeStatus(id, targetStatus)
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (!saved) return
      const p = JSON.parse(saved)
      const allKeys = defaultOrder()
      if (p.visible) setCols({ ...defaultCols(), ...p.visible })
      if (Array.isArray(p.order)) {
        const ord = (p.order as ColKey[]).filter(k => allKeys.includes(k))
        setOrder([...ord, ...allKeys.filter(k => !ord.includes(k))])
      }
    } catch {}
  }, [])

  function savePrefs(visible: Record<ColKey, boolean>, ord: ColKey[]) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ visible, order: ord })) } catch {}
  }

  useEffect(() => {
    function onOut(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [])

  function toggleCol(key: ColKey) {
    setCols(prev => {
      const next = { ...prev, [key]: !prev[key] }
      savePrefs(next, order)
      return next
    })
  }

  // Reordena colunas (arraste no menu "Colunas"); persiste por usuário.
  function moveCol(from: ColKey, to: ColKey) {
    setOrder(prev => {
      if (from === to) return prev
      const arr = [...prev]
      const fromIdx = arr.indexOf(from)
      const toIdx = arr.indexOf(to)
      if (fromIdx === -1 || toIdx === -1) return prev
      arr.splice(fromIdx, 1)
      arr.splice(toIdx, 0, from)
      savePrefs(cols, arr)
      return arr
    })
  }

  function toggleGroup(status: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(status) ? next.delete(status) : next.add(status)
      return next
    })
  }

  // Derive workspace options from campMap
  const workspaceOptions = Object.values(
    Object.values(campMap).reduce((acc, c) => {
      acc[c.workspaceId] = { id: c.workspaceId, name: c.client }
      return acc
    }, {} as Record<string, { id: string; name: string }>)
  ).sort((a, b) => a.name.localeCompare(b.name))

  // Filter activities by workspace if active, applying optimistic status overrides
  const filteredActivities = (filterWorkspace
    ? activities.filter(a => campMap[a.campaign_id]?.workspaceId === filterWorkspace)
    : activities
  ).filter(a => !hidden.has(a.id)).map(a => overrides[a.id] ? { ...a, status: overrides[a.id] } : a)

  // Colunas na ordem escolhida pelo usuário (com fallback p/ defs novas)
  const orderedCols = [...order, ...COL_DEFS.map(c => c.key).filter(k => !order.includes(k))]
    .map(k => COL_DEFS.find(c => c.key === k))
    .filter((c): c is (typeof COL_DEFS)[number] => !!c)
  const visibleCols = orderedCols.filter(c => cols[c.key])
  const totalCount  = filteredActivities.length
  const activeGroups = statusConfig.filter(s =>
    filteredActivities.some(a => a.status === s.value)
  )

  return (
    <div className="p-6">

      {/* Page header */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-gray-900">Lista de atividades</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {totalCount} atividade{totalCount !== 1 ? 's' : ''} {isArchivedView ? `arquivada${totalCount !== 1 ? 's' : ''}` : 'em andamento'}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Ativas / Arquivadas */}
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
            <Link
              href={`/${orgSlug}/views/lista`}
              className={cn('px-2.5 py-1 rounded-md transition', !isArchivedView ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700')}
            >
              Ativas
            </Link>
            <Link
              href={`/${orgSlug}/views/lista?view=arquivadas`}
              className={cn('px-2.5 py-1 rounded-md transition', isArchivedView ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700')}
            >
              Arquivadas
            </Link>
          </div>

          {/* Nova atividade — sempre disponível no topo */}
          <NewActivityButton orgSlug={orgSlug} campMap={campMap} />

        {/* Workspace filter */}
        {workspaceOptions.length > 1 && (
          <select
            value={filterWorkspace}
            onChange={e => setFilterWorkspace(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            <option value="">Todos os clientes</option>
            {workspaceOptions.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        )}

        {/* Column picker — desktop only */}
        <div className="relative hidden md:block" ref={pickerRef}>
          <button
            onClick={() => setPickerOpen(o => !o)}
            className={cn(
              'inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border transition',
              pickerOpen
                ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                : 'bg-white border-gray-200 text-gray-500 hover:text-gray-700 hover:border-gray-300'
            )}
          >
            <Columns3 className="w-4 h-4" />
            Colunas
          </button>

          {pickerOpen && (
            <div className="absolute right-0 mt-2 w-60 bg-white rounded-xl border border-gray-200 shadow-lg py-2 z-20">
              <p className="px-3 pb-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100 mb-1">
                Colunas · arraste para reordenar
              </p>
              {orderedCols.map(col => (
                <div
                  key={col.key}
                  draggable
                  onDragStart={() => setDragCol(col.key)}
                  onDragEnd={() => setDragCol(null)}
                  onDragOver={e => e.preventDefault()}
                  onDragEnter={() => { if (dragCol && dragCol !== col.key) moveCol(dragCol, col.key) }}
                  className={cn(
                    'flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-gray-50 transition cursor-grab active:cursor-grabbing',
                    dragCol === col.key && 'opacity-40'
                  )}
                >
                  <GripVertical className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                  <button
                    type="button"
                    onClick={() => toggleCol(col.key)}
                    className="flex items-center justify-between flex-1 text-sm text-gray-700 text-left"
                  >
                    <span>{col.label}</span>
                    <span className={cn(
                      'w-4 h-4 rounded border flex items-center justify-center transition',
                      cols[col.key] ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'
                    )}>
                      {cols[col.key] && <Check className="w-2.5 h-2.5 text-white" />}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        </div>
      </div>

      {/* ── Drop bar: todos os status como alvo durante o arraste ── */}
      {draggingId && (
        <div className="hidden md:flex flex-wrap items-center gap-1.5 mb-4 p-3 bg-white rounded-xl border-2 border-dashed border-indigo-200 animate-[slideUp_0.15s_ease-out]">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider w-full mb-1">
            Solte em um status
          </span>
          {statusConfig.map(s => (
            <div
              key={s.value}
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverStatus(s.value) }}
              onDragLeave={() => setDragOverStatus(prev => prev === s.value ? null : prev)}
              onDrop={e => { e.preventDefault(); handleDrop(s.value) }}
              className={cn(
                'text-xs font-semibold px-2.5 py-1 rounded-full cursor-copy transition-transform',
                s.bgColor, s.color,
                dragOverStatus === s.value && 'scale-110 ring-2 ring-indigo-400 ring-offset-1'
              )}
            >
              {s.label}
            </div>
          ))}
        </div>
      )}

      {/* ── Table ── */}
      <div className="bg-white rounded-xl border border-gray-200">

        {/* Column header — desktop only */}
        <div className="hidden md:flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-gray-50/60 rounded-t-xl">
          <div className="w-3.5 shrink-0 -ml-1" />
          <div className="w-4 shrink-0" />
          <div className="flex-1 text-xs font-medium text-gray-400">Atividade</div>
          {visibleCols.map(col => (
            <div key={col.key} className={cn('text-xs font-medium text-gray-400 shrink-0', col.width)}>
              {col.label}
            </div>
          ))}
        </div>

        {/* Status groups */}
        {activeGroups.length === 0 ? (
          <div className="text-center py-24">
            <p className="text-gray-900 font-medium">
              {isArchivedView ? 'Nenhuma atividade arquivada' : 'Nenhuma atividade em andamento'}
            </p>
            <p className="text-gray-500 text-sm mt-1">
              {isArchivedView
                ? 'Tarefas arquivadas aparecem aqui.'
                : 'Todas as atividades estão concluídas ou ainda não foram criadas.'}
            </p>
          </div>
        ) : (
          activeGroups.map(statusCfg => {
            const items = filteredActivities.filter(a => a.status === statusCfg.value)
            const isOpen = !collapsed.has(statusCfg.value)

            return (
              <div
                key={statusCfg.value}
                onDragOver={e => {
                  if (!draggingId) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setDragOverStatus(statusCfg.value)
                }}
                onDragLeave={() => setDragOverStatus(prev => prev === statusCfg.value ? null : prev)}
                onDrop={e => { e.preventDefault(); handleDrop(statusCfg.value) }}
                className={cn(
                  'border-t-8 border-gray-50 first:border-t-0 transition-colors',
                  draggingId && dragOverStatus === statusCfg.value && 'bg-indigo-50/70 ring-2 ring-inset ring-indigo-300'
                )}
              >

                {/* Group header */}
                <button
                  onClick={() => toggleGroup(statusCfg.value)}
                  className="w-full flex items-center gap-2 px-4 py-3 hover:bg-gray-50/80 transition text-left"
                >
                  <ChevronDown className={cn(
                    'w-3.5 h-3.5 text-gray-400 transition-transform shrink-0',
                    !isOpen && '-rotate-90'
                  )} />
                  <span className={cn('text-xs font-semibold px-2.5 py-0.5 rounded-full', statusCfg.bgColor, statusCfg.color)}>
                    {statusCfg.label}
                  </span>
                  <span className="text-xs font-medium text-gray-500 bg-gray-100 rounded-full px-2 py-0.5 min-w-[1.25rem] text-center">
                    {items.length}
                  </span>
                </button>

                {/* Activity rows */}
                {isOpen && (
                  <div className="divide-y divide-gray-100">
                    {items.map(activity => {
                      const camp     = campMap[activity.campaign_id]
                      const overdue  = isOverdue(activity.due_date)
                      const days     = daysUntil(activity.due_date)
                      const cxKey = activity.complexity as keyof typeof COMPLEXITY_ICON | undefined
                      const ComplexityIcon = cxKey ? COMPLEXITY_ICON[cxKey] : null
                      const complexity = cxKey ? COMPLEXITY_CONFIG[cxKey] : null
                      const href = `/${orgSlug}/workspaces/${camp?.workspaceId}/campaigns/${activity.campaign_id}/activities/${activity.id}`

                      const dueBadge = activity.due_date ? (
                        <span className={cn(
                          'text-xs font-medium flex items-center gap-1 shrink-0',
                          overdue ? 'text-red-600' : days !== null && days <= 3 ? 'text-orange-500' : 'text-gray-500'
                        )}>
                          {overdue && <AlertCircle className="w-3 h-3 shrink-0" />}
                          {overdue ? `${Math.abs(days!)}d atraso` : days === 0 ? 'Hoje' : days === 1 ? 'Amanhã' : `${days}d`}
                        </span>
                      ) : null

                      // Conteúdo de cada coluna (renderizado na ordem escolhida pelo usuário)
                      function renderCell(key: ColKey) {
                        switch (key) {
                          case 'responsavel':
                            return <AssigneeCell activityId={activity.id} assignedIds={activity.assignedIds} members={members} />
                          case 'prazo':
                            return <DateRangeEditor activityId={activity.id} path={listPath} startDate={activity.start_date ?? null} dueDate={activity.due_date} canEdit compact />
                          case 'prioridade':
                            return <PriorityCell activityId={activity.id} current={activity.priority} path={listPath} />
                          case 'complexidade':
                            return ComplexityIcon
                              ? <span title={`Complexidade: ${complexity?.label}`}><ComplexityIcon className={cn('w-4 h-4', complexity?.color)} /></span>
                              : <span className="text-xs text-gray-300">—</span>
                          case 'layout':
                            return activity.layout_url ? (
                              <div className="flex items-center gap-1 min-w-0">
                                <a
                                  href={activity.layout_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={e => e.stopPropagation()}
                                  className="inline-flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 hover:underline min-w-0"
                                >
                                  <ExternalLink className="w-3 h-3 shrink-0" />
                                  <span className="truncate">Drive</span>
                                </a>
                                <CopyButton text={activity.layout_url} label="Copiar link do Drive" />
                              </div>
                            ) : <span className="text-xs text-gray-300">—</span>
                          default:
                            return null
                        }
                      }

                      return (
                        <div key={activity.id} className="hover:bg-gray-50/60 transition group">

                          {/* ── Mobile layout ─────────────────────────── */}
                          <div className="md:hidden flex items-center gap-3 px-4 py-3">
                            <StatusDot
                              current={activity.status}
                              statusConfig={statusConfig}
                              onChange={(s) => changeStatus(activity.id, s)}
                            />
                            <Link href={href} className="flex items-center gap-3 flex-1 min-w-0">
                              <div className="flex-1 min-w-0">
                                {camp && (
                                  <span className="text-[11px] text-gray-500 block leading-tight mb-0.5 truncate">
                                    {camp.client} / {camp.name}
                                  </span>
                                )}
                                <span className="text-sm font-medium text-gray-900 group-hover:text-indigo-600 transition block truncate">
                                  {activity.title}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {dueBadge}
                                {activity.assignees.length > 0 && (
                                  <AvatarGroup users={activity.assignees} />
                                )}
                              </div>
                            </Link>
                          </div>

                          {/* ── Desktop layout — arrastável entre status ── */}
                          <div
                            draggable
                            onDragStart={e => {
                              e.dataTransfer.setData('text/plain', activity.id)
                              e.dataTransfer.effectAllowed = 'move'
                              setDraggingId(activity.id)
                            }}
                            onDragEnd={() => { setDraggingId(null); setDragOverStatus(null) }}
                            className={cn(
                              'hidden md:flex items-center gap-2 px-4 py-2.5 group cursor-grab active:cursor-grabbing',
                              draggingId === activity.id && 'opacity-40'
                            )}
                          >
                            {/* Grip — aparece no hover */}
                            <GripVertical className="w-3.5 h-3.5 text-gray-300 opacity-0 group-hover:opacity-100 transition shrink-0 -ml-1" />

                            {/* Seletor de status (bolinha) */}
                            <StatusDot
                              current={activity.status}
                              statusConfig={statusConfig}
                              onChange={(s) => changeStatus(activity.id, s)}
                            />

                            {/* Name */}
                            <div className="flex-1 min-w-0">
                              <Link href={href} draggable={false} className="block">
                                {camp && (
                                  <span className="text-[11px] text-gray-500 block leading-tight mb-0.5">
                                    {camp.client} / {camp.name}
                                  </span>
                                )}
                                <span className="text-sm font-medium text-gray-900 group-hover:text-indigo-600 transition truncate block">
                                  {activity.title}
                                </span>
                              </Link>
                            </div>

                            {/* Colunas — na ordem escolhida pelo usuário */}
                            {visibleCols.map(col => (
                              <div key={col.key} className={cn('shrink-0', col.width)}>
                                {renderCell(col.key)}
                              </div>
                            ))}

                            {/* Ação: arquivar / desarquivar */}
                            <button
                              type="button"
                              title={isArchivedView ? 'Desarquivar' : 'Arquivar'}
                              onClick={e => { e.preventDefault(); e.stopPropagation(); archiveActivity(activity.id, activity.title) }}
                              className="p-1 rounded text-gray-300 hover:text-indigo-600 hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition shrink-0"
                            >
                              {isArchivedView ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                            </button>
                          </div>

                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ── Seletor de status inline (bolinha + dropdown), estilo ClickUp ───────────
function StatusDot({
  current,
  statusConfig,
  onChange,
}: {
  current: string
  statusConfig: { value: string; label: string; bgColor: string; color: string }[]
  onChange: (status: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onOut(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [open])

  const cfg = statusConfig.find(s => s.value === current)

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        title={cfg?.label ? `Status: ${cfg.label} — clique para mudar` : 'Mudar status'}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o) }}
        className={cn(
          'w-4 h-4 rounded-full border-2 border-current flex items-center justify-center hover:scale-110 transition',
          cfg?.color ?? 'text-gray-300'
        )}
      >
        <Check className="w-2.5 h-2.5" strokeWidth={3.5} />
      </button>

      {open && (
        <div className="absolute left-0 top-6 z-30 w-56 bg-white rounded-xl border border-gray-200 shadow-lg py-1.5 max-h-72 overflow-y-auto">
          <p className="px-3 pb-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            Mudar status
          </p>
          {statusConfig.map(s => (
            <button
              key={s.value}
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false); onChange(s.value) }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 transition text-left"
            >
              <span className={cn('w-2.5 h-2.5 rounded-full border-2 border-current shrink-0', s.color)} />
              <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', s.bgColor, s.color)}>
                {s.label}
              </span>
              {s.value === current && <Check className="w-3 h-3 text-gray-400 ml-auto shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Botão "Nova atividade" sempre no topo (escolhe a campanha de destino) ───
function NewActivityButton({
  orgSlug,
  campMap,
}: {
  orgSlug: string
  campMap: Record<string, CampInfo>
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onOut(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [open])

  const items = Object.entries(campMap)
    .map(([id, c]) => ({ id, ...c }))
    .sort((a, b) => a.client.localeCompare(b.client) || a.name.localeCompare(b.name))
  const term = q.trim().toLowerCase()
  const filtered = term
    ? items.filter(i => `${i.client} ${i.name}`.toLowerCase().includes(term))
    : items

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition"
      >
        <Plus className="w-4 h-4" />
        <span className="hidden sm:inline">Nova atividade</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl border border-gray-200 shadow-lg z-30 overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 rounded-lg">
              <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar campanha…"
                className="flex-1 bg-transparent text-sm text-gray-700 placeholder-gray-400 focus:outline-none"
              />
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-xs text-gray-400 text-center">Nenhuma campanha encontrada</p>
            ) : (
              filtered.map(i => (
                <Link
                  key={i.id}
                  href={`/${orgSlug}/workspaces/${i.workspaceId}/campaigns/${i.id}/activities/new`}
                  className="block px-3 py-2 hover:bg-gray-50 transition"
                >
                  <span className="text-[11px] text-gray-400 block leading-tight">{i.client}</span>
                  <span className="text-sm text-gray-800">{i.name}</span>
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Botão copiar para o clipboard ──────────────────────────────────────────
function CopyButton({ text, label = 'Copiar' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      title={label}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true)
          toast.success('Copiado!')
          setTimeout(() => setCopied(false), 1200)
        }).catch(() => toast.error('Não foi possível copiar'))
      }}
      className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition shrink-0"
    >
      {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
    </button>
  )
}

// ── Responsável inline (avatares + dropdown de membros) ─────────────────────
function AssigneeCell({ activityId, assignedIds, members }: {
  activityId: string
  assignedIds: string[]
  members: Member[]
}) {
  const [selected, setSelected] = useState<string[]>(assignedIds)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onOut(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [open])

  async function toggle(userId: string) {
    const u = getUsuarioClient()
    if (!u) return
    const was = selected.includes(userId)
    setSelected(prev => was ? prev.filter(id => id !== userId) : [...prev, userId]) // otimista
    const { error } = await createClient().rpc('toggle_activity_assignee', {
      p_user_id: u.id, p_activity_id: activityId, p_assignee_id: userId,
    })
    if (error) {
      setSelected(prev => was ? [...prev, userId] : prev.filter(id => id !== userId))
      toast.error(error.message)
    }
  }

  const assigned = members.filter(m => selected.includes(m.userId))

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        title="Editar responsáveis"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o) }}
        className="flex items-center hover:opacity-80 transition"
      >
        {assigned.length > 0
          ? <AvatarGroup users={assigned.map(m => ({ full_name: m.fullName, avatar_url: m.avatarUrl }))} />
          : <span className="text-xs text-gray-300 hover:text-indigo-500 transition">+ atribuir</span>}
      </button>
      {open && (
        <div className="absolute left-0 top-7 z-30 w-56 bg-white rounded-xl border border-gray-200 shadow-lg py-1.5 max-h-64 overflow-y-auto">
          {members.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400">Nenhum membro</p>
          ) : members.map(m => {
            const on = selected.includes(m.userId)
            return (
              <button
                key={m.userId}
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(m.userId) }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 transition text-left"
              >
                <span className={cn('w-4 h-4 rounded border flex items-center justify-center shrink-0', on ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300')}>
                  {on && <Check className="w-2.5 h-2.5 text-white" />}
                </span>
                <span className="text-sm text-gray-700 truncate">{m.fullName ?? m.email.split('@')[0]}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Prioridade inline (bandeira + menu) ─────────────────────────────────────
function PriorityCell({ activityId, current, path }: { activityId: string; current: string; path: string }) {
  const [value, setValue] = useState(current)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onOut(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [open])

  const p = PRIORITY_CONFIG[value as ActivityPriority]
  const order: ActivityPriority[] = ['urgent', 'high', 'medium', 'low']

  async function set(v: ActivityPriority) {
    setOpen(false)
    if (v === value) return
    const prev = value
    setValue(v) // otimista
    const r = await updateActivityField(path, activityId, 'priority', v)
    if (r?.error) { setValue(prev); toast.error(r.error) }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        title={`Prioridade: ${p.label}`}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o) }}
        className="hover:scale-110 transition"
      >
        <Flag className={cn('w-4 h-4', p.color, (value === 'urgent' || value === 'high') && 'fill-current')} />
      </button>
      {open && (
        <div className="absolute left-0 top-7 z-30 w-44 bg-white rounded-xl border border-gray-200 shadow-lg py-1.5">
          {order.map(pk => {
            const cfg = PRIORITY_CONFIG[pk]
            return (
              <button
                key={pk}
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); set(pk) }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 transition text-left"
              >
                <Flag className={cn('w-4 h-4', cfg.color, (pk === 'urgent' || pk === 'high') && 'fill-current')} />
                <span className="text-sm text-gray-700">{cfg.label}</span>
                {pk === value && <Check className="w-3 h-3 text-gray-400 ml-auto" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

