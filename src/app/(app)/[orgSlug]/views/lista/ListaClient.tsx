'use client'

import { useState, useEffect, useRef, useTransition, type ReactNode, type ComponentType } from 'react'
import Link from 'next/link'
import { cn, isOverdue, daysUntil, dueLabel } from '@/lib/utils'
import { PRIORITY_CONFIG, COMPLEXITY_CONFIG, type ActivityPriority } from '@/types'
import { AlertCircle, ExternalLink, ChevronDown, Columns3, Check, GripVertical, Plus, Search, Flag, SignalLow, SignalMedium, SignalHigh, Copy, Archive, ArchiveRestore, X, Calendar, UserPlus, Minus, Circle, User, Bookmark, Loader2 } from 'lucide-react'

// Complexidade → ícone (1/2/3 barras)
const COMPLEXITY_ICON = { simple: SignalLow, medium: SignalMedium, complex: SignalHigh } as const
import { AvatarGroup } from '@/components/ui/Avatar'
import { DateRangeEditor } from '@/components/ui/DateRangeEditor'
import { MachinePath } from '@/components/ui/MachinePath'
import { MultiSelect, Select } from '@/components/ui/Select'
import { useStatusConfig } from '@/components/ui/StatusBadge'
import { updateActivityStatus, updateActivityField, setActivityArchived, bulkUpdateStatus, bulkUpdateField, bulkToggleAssignee, bulkSetArchived, createActivityInline } from '@/app/actions/activity'
import { createClient } from '@/lib/supabase/client'
import { getUsuarioClient } from '@/lib/auth/client'
import { toast } from 'sonner'

// ── Column definitions ────────────────────────────────────────────────────

type ColKey = 'responsavel' | 'prazo' | 'prioridade' | 'complexidade' | 'redacao' | 'preview' | 'caminho' | 'ultimoComentario'

const COL_DEFS: { key: ColKey; label: string; defaultOn: boolean; width: string }[] = [
  { key: 'responsavel',      label: 'Responsável',       defaultOn: true,  width: 'w-32' },
  { key: 'prazo',            label: 'Prazo',             defaultOn: true,  width: 'w-24' },
  { key: 'prioridade',       label: 'Prioridade',        defaultOn: true,  width: 'w-20' },
  { key: 'complexidade',     label: 'Complexidade',      defaultOn: false, width: 'w-24' },
  { key: 'redacao',          label: 'Redação',           defaultOn: true,  width: 'w-24' },
  { key: 'preview',          label: 'Preview',           defaultOn: true,  width: 'w-24' },
  { key: 'caminho',          label: 'Drive',             defaultOn: false, width: 'w-56' },
  { key: 'ultimoComentario', label: 'Último comentário', defaultOn: false, width: 'w-48' },
]

const STORAGE_KEY = 'lista-cols-v7'

function defaultCols(): Record<ColKey, boolean> {
  return Object.fromEntries(COL_DEFS.map(c => [c.key, c.defaultOn])) as Record<ColKey, boolean>
}

const defaultOrder = (): ColKey[] => COL_DEFS.map(c => c.key)

// ── Filtros salvos (presets, por org no localStorage) ───────────────────────
type SavedFilter = { id: string; name: string; workspaces: string[]; persons: string[]; statuses: string[]; priorities?: string[]; date?: string; onlyMine?: boolean }
const PRIORITY_OPTIONS = Object.entries(PRIORITY_CONFIG).map(([value, cfg]) => ({ value, label: cfg.label }))
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x))

// ── Filtro de prazo (presets) ───────────────────────────────────────────────
const DATE_FILTERS = [
  { value: '',          label: 'Qualquer prazo' },
  { value: 'overdue',   label: 'Atrasadas' },
  { value: 'due3',      label: 'Atrasadas + 3 dias' },
  { value: 'nextweek',  label: 'Próxima semana' },
  { value: 'next15',    label: 'Próximos 15 dias' },
  { value: 'noduedate', label: 'Sem prazo' },
]
function shiftYMD(base: string, days: number) {
  const [y, m, d] = base.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}
/** Próxima semana = segunda a domingo da semana seguinte. */
function nextWeekRange(today: string): [string, string] {
  const [y, m, d] = today.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 dom … 6 sáb
  const toMon = (1 - dow + 7) % 7
  const start = shiftYMD(today, toMon === 0 ? 7 : toMon)
  return [start, shiftYMD(start, 6)]
}
function matchesDateFilter(due: string | null, f: string, today: string): boolean {
  if (!f) return true
  if (f === 'noduedate') return !due
  if (!due) return false
  const d = due.slice(0, 10)
  if (f === 'overdue') return d < today
  if (f === 'due3') return d <= shiftYMD(today, 3)
  if (f === 'next15') return d >= today && d <= shiftYMD(today, 15)
  if (f === 'nextweek') { const [s, e] = nextWeekRange(today); return d >= s && d <= e }
  return true
}

// ── Types ─────────────────────────────────────────────────────────────────

interface Assignee { full_name: string | null; avatar_url: string | null }
interface Member { userId: string; fullName: string | null; email: string; avatarUrl: string | null }
interface LastComment { content: string; at: string; author: string | null }
interface Activity {
  id: string; title: string; status: string; priority: string
  due_date: string | null; start_date?: string | null; complexity?: string | null
  redacao_url: string | null; preview_url: string | null; drive_path: string | null; lastComment: LastComment | null
  campaign_id: string; assignees: Assignee[]; assignedIds: string[]
}
interface CampInfo { name: string; client: string; workspaceId: string }
interface Props {
  orgSlug: string
  activities: Activity[]
  campMap: Record<string, CampInfo>
  members: Member[]
  initialWorkspace?: string
  view: 'ativas' | 'arquivadas'
  /** Título do cabeçalho (default "Lista de atividades"; na tela de cargo = nome do cargo). */
  title?: string
  /** Rota base para os links/revalidate (default "views/lista"). */
  routeBase?: string
  /** Caminho de navegação acima do título (ex.: "Clientes / Comil"). */
  breadcrumb?: ReactNode
  /** Ações ao lado do título (ex.: engrenagem editar/arquivar cliente). */
  titleActions?: ReactNode
  /** Botão secundário na barra de ações (ex.: "Nova campanha"). */
  secondaryActions?: ReactNode
  /** Quando definido, "Nova atividade" vai direto p/ esta campanha (sem seletor). */
  newActivityCampaign?: { workspaceId: string; campaignId: string }
}

// ── Component ─────────────────────────────────────────────────────────────

export function ListaClient({ orgSlug, activities, campMap, members, initialWorkspace, view, title = 'Lista de atividades', routeBase = 'views/lista', breadcrumb, titleActions, secondaryActions, newActivityCampaign }: Props) {
  const listPath = `/${orgSlug}/${routeBase}`
  const statusConfig = useStatusConfig()
  const isArchivedView = view === 'arquivadas'
  // Otimista: esconde itens recém-(des)arquivados até o revalidate do servidor.
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  // Seleção múltipla (ações em lote)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkPending, startBulk] = useTransition()

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
  // Concluído começa recolhido (fluxo: revisar → selecionar pelo checkbox do grupo → arquivar).
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(['concluido']))
  const [filterWorkspaces, setFilterWorkspaces] = useState<string[]>(initialWorkspace ? [initialWorkspace] : [])
  const [filterPersons,  setFilterPersons]  = useState<string[]>([])
  const [filterStatuses, setFilterStatuses] = useState<string[]>([])
  const [filterPriorities, setFilterPriorities] = useState<string[]>([])
  const [filterDate, setFilterDate] = useState('')
  const [onlyMine, setOnlyMine] = useState(false)
  const me = getUsuarioClient()?.id ?? null
  const pickerRef = useRef<HTMLDivElement>(null)

  // Filtros salvos (presets por org)
  const SAVED_KEY = `lista-filtros:${orgSlug}`
  const [saved,    setSaved]    = useState<SavedFilter[]>([])
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const saveRef = useRef<HTMLDivElement>(null)

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
      const result = await updateActivityStatus(listPath, id, targetStatus, '')
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

  // ── Filtros salvos: carrega do localStorage + fecha o "Salvar" ao clicar fora ──
  useEffect(() => {
    try { const s = localStorage.getItem(SAVED_KEY); if (s) setSaved(JSON.parse(s)) } catch {}
  }, [SAVED_KEY])

  // ── Último filtro usado: restaura ao montar e lembra a cada mudança ──
  // Chave por org E por rota (Lista ≠ Trabalhar — contexto de cargo não mistura).
  // Um ?ws= explícito na URL vence o filtro lembrado.
  const LAST_FILTER_KEY = `lista-ultimo-filtro-v1:${orgSlug}:${routeBase}`
  const lastFilterReady = useRef(false)
  /* eslint-disable react-hooks/set-state-in-effect -- restaurar do localStorage
     exige setState pós-mount (initializer daria mismatch de hidratação SSR);
     mesmo padrão dos efeitos de colunas/presets acima. */
  useEffect(() => {
    try {
      if (!initialWorkspace) {
        const s = localStorage.getItem(LAST_FILTER_KEY)
        if (s) {
          const f = JSON.parse(s)
          if (Array.isArray(f.workspaces)) setFilterWorkspaces(f.workspaces)
          if (Array.isArray(f.persons))    setFilterPersons(f.persons)
          if (Array.isArray(f.statuses))   setFilterStatuses(f.statuses)
          if (Array.isArray(f.priorities)) setFilterPriorities(f.priorities)
          if (typeof f.date === 'string')  setFilterDate(f.date)
          if (typeof f.onlyMine === 'boolean') setOnlyMine(f.onlyMine)
        }
      }
    } catch {}
    lastFilterReady.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!lastFilterReady.current) return
    try {
      localStorage.setItem(LAST_FILTER_KEY, JSON.stringify({
        workspaces: filterWorkspaces, persons: filterPersons, statuses: filterStatuses, priorities: filterPriorities, date: filterDate, onlyMine,
      }))
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterWorkspaces, filterPersons, filterStatuses, filterPriorities, filterDate, onlyMine])

  useEffect(() => {
    if (!saveOpen) return
    function onOut(e: MouseEvent) { if (saveRef.current && !saveRef.current.contains(e.target as Node)) setSaveOpen(false) }
    document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [saveOpen])

  function persistSaved(next: SavedFilter[]) {
    setSaved(next)
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(next)) } catch {}
  }
  function saveCurrentFilter() {
    const name = saveName.trim()
    if (!name) return
    persistSaved([...saved, { id: `${Date.now()}`, name, workspaces: filterWorkspaces, persons: filterPersons, statuses: filterStatuses, priorities: filterPriorities, date: filterDate, onlyMine }])
    setSaveName(''); setSaveOpen(false)
  }
  function applySavedFilter(f: SavedFilter) {
    setFilterWorkspaces(f.workspaces); setFilterPersons(f.persons); setFilterStatuses(f.statuses)
    setFilterPriorities(f.priorities ?? []); setFilterDate(f.date ?? ''); setOnlyMine(f.onlyMine ?? false)
  }
  function deleteSavedFilter(id: string) { persistSaved(saved.filter(f => f.id !== id)) }
  function isSavedActive(f: SavedFilter) {
    return sameSet(f.workspaces, filterWorkspaces) && sameSet(f.persons, filterPersons) && sameSet(f.statuses, filterStatuses)
      && sameSet(f.priorities ?? [], filterPriorities) && (f.date ?? '') === filterDate && (f.onlyMine ?? false) === onlyMine
  }

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
  const todayYMD = new Date().toISOString().slice(0, 10)
  const filteredActivities = activities
    .filter(a => !hidden.has(a.id))
    .map(a => overrides[a.id] ? { ...a, status: overrides[a.id] } : a)
    .filter(a => !onlyMine || (!!me && a.assignedIds.includes(me)))
    .filter(a => filterWorkspaces.length === 0 || filterWorkspaces.includes(campMap[a.campaign_id]?.workspaceId ?? ''))
    .filter(a => filterPersons.length === 0 || a.assignedIds.some(id => filterPersons.includes(id)))
    .filter(a => filterStatuses.length === 0 || filterStatuses.includes(a.status))
    .filter(a => filterPriorities.length === 0 || filterPriorities.includes(a.priority))
    .filter(a => matchesDateFilter(a.due_date, filterDate, todayYMD))
  const hasFilter = filterWorkspaces.length + filterPersons.length + filterStatuses.length + filterPriorities.length > 0 || !!filterDate

  // Colunas na ordem escolhida pelo usuário (com fallback p/ defs novas)
  const orderedCols = [...order, ...COL_DEFS.map(c => c.key).filter(k => !order.includes(k))]
    .map(k => COL_DEFS.find(c => c.key === k))
    .filter((c): c is (typeof COL_DEFS)[number] => !!c)
  const visibleCols = orderedCols.filter(c => cols[c.key])
  const totalCount  = filteredActivities.length
  // Ordem invertida (Concluído no topo, Briefing no final) — preferência do usuário
  const activeGroups = statusConfig.filter(s =>
    filteredActivities.some(a => a.status === s.value)
  ).reverse()

  // ── Seleção múltipla ──
  const selectedIds = [...selected]
  const selectionActive = selectedIds.length > 0
  const visibleIds = filteredActivities.map(a => a.id)
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id))

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function setMany(ids: string[], on: boolean) {
    setSelected(prev => { const n = new Set(prev); ids.forEach(id => on ? n.add(id) : n.delete(id)); return n })
  }
  function clearSelection() { setSelected(new Set()) }

  function bulkApplyStatus(status: string) {
    const ids = selectedIds
    setOverrides(prev => { const n = { ...prev }; ids.forEach(id => { n[id] = status }); return n })
    const label = statusConfig.find(s => s.value === status)?.label ?? status
    startBulk(async () => {
      const r = await bulkUpdateStatus(listPath, ids, status)
      if (r?.error) {
        setOverrides(prev => { const n = { ...prev }; ids.forEach(id => delete n[id]); return n })
        toast.error(r.error)
      } else {
        toast.success(`${ids.length} movida${ids.length !== 1 ? 's' : ''} para ${label}`)
        clearSelection()
      }
    })
  }

  function bulkApplyArchive() {
    const ids = selectedIds
    setHidden(prev => { const n = new Set(prev); ids.forEach(id => n.add(id)); return n })
    startBulk(async () => {
      const r = await bulkSetArchived(listPath, ids, !isArchivedView)
      if (r?.error) {
        setHidden(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n })
        toast.error(r.error)
      } else {
        toast.success(isArchivedView ? `${ids.length} desarquivada${ids.length !== 1 ? 's' : ''}` : `${ids.length} arquivada${ids.length !== 1 ? 's' : ''}`)
        clearSelection()
      }
    })
  }

  // Datas em lote (intervalo início → prazo). undefined = não mexe no campo;
  // null = limpa; string = define. Permite aplicar só o prazo sem zerar o início.
  function bulkApplyDates(start: string | null | undefined, due: string | null | undefined) {
    const ids = selectedIds
    startBulk(async () => {
      let error: string | undefined
      if (start !== undefined) {
        const r = await bulkUpdateField(listPath, ids, 'start_date', start)
        if (r?.error) error = r.error
      }
      if (!error && due !== undefined) {
        const r = await bulkUpdateField(listPath, ids, 'due_date', due)
        if (r?.error) error = r.error
      }
      if (error) toast.error(error)
      else {
        toast.success(start === null && due === null ? `Datas removidas de ${ids.length}` : `Datas atualizadas em ${ids.length}`)
        clearSelection()
      }
    })
  }

  // Responsáveis em lote (multi): para cada pessoa escolhida, adiciona só a quem
  // ainda não a tem (toggle = adicionar, sem remover quem já está).
  function bulkApplyAssignees(userIds: string[]) {
    if (userIds.length === 0) return
    startBulk(async () => {
      let error: string | undefined
      for (const uid of userIds) {
        const ids = filteredActivities.filter(a => selected.has(a.id) && !a.assignedIds.includes(uid)).map(a => a.id)
        if (ids.length === 0) continue
        const r = await bulkToggleAssignee(listPath, ids, uid)
        if (r?.error) { error = r.error; break }
      }
      if (error) toast.error(error)
      else { toast.success(userIds.length === 1 ? 'Responsável adicionado' : 'Responsáveis adicionados'); clearSelection() }
    })
  }

  return (
    <div className="p-6">

      {/* Page header */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="min-w-0">
          {breadcrumb && <div className="mb-1 text-xs text-gray-400">{breadcrumb}</div>}
          <div className="flex items-center gap-1.5 min-w-0">
            <h1 className="text-lg font-semibold text-gray-900 truncate">{title}</h1>
            {titleActions}
          </div>
          <p className="text-gray-500 text-sm mt-0.5">
            {totalCount} atividade{totalCount !== 1 ? 's' : ''} {isArchivedView ? `arquivada${totalCount !== 1 ? 's' : ''}` : 'em andamento'}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Ativas / Arquivadas */}
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
            <Link
              href={`/${orgSlug}/${routeBase}`}
              className={cn('px-2.5 py-1 rounded-md transition', !isArchivedView ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700')}
            >
              Ativas
            </Link>
            <Link
              href={`/${orgSlug}/${routeBase}?view=arquivadas`}
              className={cn('px-2.5 py-1 rounded-md transition', isArchivedView ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700')}
            >
              Arquivadas
            </Link>
          </div>

          {/* Eu — só as tarefas em que sou responsável */}
          <button
            type="button"
            onClick={() => setOnlyMine(v => !v)}
            title="Mostrar só as tarefas em que sou responsável"
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg border transition',
              onlyMine
                ? 'bg-orange-50 border-orange-200 text-orange-700'
                : 'bg-white border-gray-200 text-gray-500 hover:text-gray-700 hover:border-gray-300'
            )}
          >
            <User className="w-4 h-4" />
            Eu
          </button>

          {/* separador: filtros | ações */}
          <div className="w-px h-6 bg-gray-200 mx-0.5" />

          {secondaryActions}

          {/* Nova atividade — canto direito, separada dos filtros */}
          <NewActivityButton orgSlug={orgSlug} campMap={campMap} fixedCampaign={newActivityCampaign} />

        </div>
      </div>

      {/* ── Filtros: Cliente · Pessoas · Status + presets salvos ── */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {workspaceOptions.length > 1 && (
          <MultiSelect
            values={filterWorkspaces}
            onChange={setFilterWorkspaces}
            className="w-44"
            allLabel="Todos os clientes"
            options={workspaceOptions.map(w => ({ value: w.id, label: w.name }))}
          />
        )}
        <MultiSelect
          values={filterPersons}
          onChange={setFilterPersons}
          className="w-44"
          allLabel="Todas as pessoas"
          options={members.map(m => ({ value: m.userId, label: m.fullName ?? m.email }))}
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
        <Select
          value={filterDate}
          onChange={setFilterDate}
          className="w-44"
          options={DATE_FILTERS}
        />
        {hasFilter && (
          <button
            onClick={() => { setFilterWorkspaces([]); setFilterPersons([]); setFilterStatuses([]); setFilterPriorities([]); setFilterDate('') }}
            className="text-xs text-gray-400 hover:text-gray-600 transition px-2 py-1.5"
          >
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

        {/* Presets salvos (chips) */}
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

      {/* ── Drop bar: todos os status como alvo durante o arraste ── */}
      {draggingId && (
        <div className="hidden md:flex flex-wrap items-center gap-1.5 mb-4 p-3 bg-white rounded-xl border-2 border-dashed border-orange-200 animate-[slideUp_0.15s_ease-out]">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider w-full mb-1">
            Solte em um status
          </span>
          {statusConfig.map(s => (
            <div
              key={s.value}
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverStatus(s.value) }}
              onDragLeave={() => setDragOverStatus(prev => prev === s.value ? null : prev)}
              onDrop={e => { e.preventDefault(); handleDrop(s.value) }}
              style={{ backgroundColor: s.bg, color: s.text }}
              className={cn(
                'text-xs font-semibold px-2.5 py-1 rounded-full cursor-copy transition-transform',
                dragOverStatus === s.value && 'scale-110 ring-2 ring-orange-400 ring-offset-1'
              )}
            >
              {s.label}
            </div>
          ))}
        </div>
      )}

      {/* ── Table ── */}
      <div>

        {/* Column header — desktop only */}
        <div className="hidden md:flex items-center gap-2 px-4 py-2">
          <SelectBox
            checked={allVisibleSelected}
            indeterminate={selectionActive && !allVisibleSelected}
            onChange={() => setMany(visibleIds, !allVisibleSelected)}
          />
          <div className="w-3.5 shrink-0 -ml-1" />
          <div className="w-4 shrink-0" />
          <div className="flex-1 text-xs font-medium text-gray-400">Atividade</div>
          {visibleCols.map(col => (
            <div
              key={col.key}
              draggable
              onDragStart={() => setDragCol(col.key)}
              onDragEnd={() => setDragCol(null)}
              onDragOver={e => e.preventDefault()}
              onDragEnter={() => { if (dragCol && dragCol !== col.key) moveCol(dragCol, col.key) }}
              title="Arraste para reordenar"
              className={cn(
                'text-xs font-medium text-gray-400 shrink-0 cursor-grab select-none transition hover:text-gray-600',
                col.width,
                dragCol === col.key && 'opacity-40',
              )}
            >
              {col.label}
            </div>
          ))}
          {/* Colunas — ícone no fim da linha de títulos (mostrar/ocultar/reordenar) */}
          <div className="relative shrink-0" ref={pickerRef}>
            <button
              type="button"
              onClick={() => setPickerOpen(o => !o)}
              title="Colunas — mostrar, ocultar e reordenar"
              className={cn(
                'flex items-center justify-center w-[22px] h-[22px] rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition',
                pickerOpen && 'bg-orange-50 text-orange-600'
              )}
            >
              <Columns3 className="w-4 h-4" />
            </button>

            {pickerOpen && (
              <div className="pop-in absolute right-0 mt-2 w-60 bg-white rounded-xl border border-gray-200 shadow-lg py-2 z-30">
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
                        cols[col.key] ? 'bg-orange-600 border-orange-600' : 'border-gray-300'
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

        {/* Status groups */}
        {activeGroups.length === 0 ? (
          <div className="text-center py-24 bg-white rounded-xl border border-gray-200 shadow-sm">
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
          <div className="space-y-2.5 stagger-in">
          {activeGroups.map(statusCfg => {
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
                  // focus-within eleva o card do grupo (relative+z) enquanto um dropdown
                  // de linha está aberto — senão o card do grupo de baixo (stacking context
                  // do stagger-in) pinta por cima do dropdown.
                  'bg-white rounded-xl border border-gray-200 shadow-sm transition-colors focus-within:relative focus-within:z-30',
                  draggingId && dragOverStatus === statusCfg.value && 'ring-2 ring-inset ring-orange-300'
                )}
              >

                {/* Group header */}
                <div className="w-full flex items-center gap-2 px-4 py-2.5 rounded-t-xl">
                  <SelectBox
                    checked={items.length > 0 && items.every(a => selected.has(a.id))}
                    indeterminate={items.some(a => selected.has(a.id)) && !items.every(a => selected.has(a.id))}
                    onChange={() => {
                      const ids = items.map(a => a.id)
                      setMany(ids, !ids.every(id => selected.has(id)))
                    }}
                  />
                  <button
                    onClick={() => toggleGroup(statusCfg.value)}
                    className="flex items-center gap-2 flex-1 text-left hover:opacity-80 transition"
                  >
                    <ChevronDown className={cn(
                      'w-3.5 h-3.5 text-gray-400 transition-transform shrink-0',
                      !isOpen && '-rotate-90'
                    )} />
                    <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
                      style={{ backgroundColor: statusCfg.bg, color: statusCfg.text }}>
                      {statusCfg.label}
                    </span>
                    <span className="text-xs font-medium text-gray-500 bg-gray-100 rounded-full px-2 py-0.5 min-w-[1.25rem] text-center">
                      {items.length}
                    </span>
                  </button>
                </div>

                {/* Activity rows */}
                {isOpen && (
                  <div className="divide-y divide-gray-100 border-t border-gray-100">
                    {items.map(activity => {
                      const camp     = campMap[activity.campaign_id]
                      const isSel    = selected.has(activity.id)
                      const overdue  = isOverdue(activity.due_date)
                      const days     = daysUntil(activity.due_date)
                      const dueTxt   = dueLabel(activity.due_date)
                      const cxKey = activity.complexity as keyof typeof COMPLEXITY_ICON | undefined
                      const ComplexityIcon = cxKey ? COMPLEXITY_ICON[cxKey] : null
                      const complexity = cxKey ? COMPLEXITY_CONFIG[cxKey] : null
                      const href = `/${orgSlug}/workspaces/${camp?.workspaceId}/campaigns/${activity.campaign_id}/activities/${activity.id}?from=${encodeURIComponent(`/${orgSlug}/${routeBase}`)}`

                      const dueBadge = activity.due_date ? (
                        <span className={cn(
                          'text-xs font-medium flex items-center gap-1 shrink-0',
                          overdue ? 'text-red-600' : days !== null && days <= 3 ? 'text-orange-500' : 'text-gray-500'
                        )}>
                          {overdue && <AlertCircle className="w-3 h-3 shrink-0" />}
                          {dueTxt}
                        </span>
                      ) : null

                      // Conteúdo de cada coluna (renderizado na ordem escolhida pelo usuário)
                      function renderCell(key: ColKey) {
                        switch (key) {
                          case 'responsavel':
                            return <AssigneeCell key={activity.assignedIds.join('-')} activityId={activity.id} assignedIds={activity.assignedIds} members={members} />
                          case 'prazo':
                            return <DateRangeEditor key={`${activity.start_date ?? ''}_${activity.due_date ?? ''}`} activityId={activity.id} path={listPath} startDate={activity.start_date ?? null} dueDate={activity.due_date} canEdit compact />
                          case 'prioridade':
                            return <PriorityCell activityId={activity.id} current={activity.priority} path={listPath} />
                          case 'complexidade':
                            return ComplexityIcon
                              ? <span title={`Complexidade: ${complexity?.label}`}><ComplexityIcon className={cn('w-4 h-4', complexity?.color)} /></span>
                              : <span className="text-xs text-gray-300">—</span>
                          case 'redacao':
                            return activity.redacao_url
                              ? <DriveLink url={activity.redacao_url} label="Redação" />
                              : <span className="text-xs text-gray-300">—</span>
                          case 'preview':
                            return activity.preview_url
                              ? <DriveLink url={activity.preview_url} label="Preview" />
                              : <span className="text-xs text-gray-300">—</span>
                          case 'caminho':
                            return activity.drive_path
                              ? <MachinePath winPath={activity.drive_path} compact />
                              : <span className="text-xs text-gray-300">—</span>
                          case 'ultimoComentario':
                            return activity.lastComment ? (
                              <span
                                className="text-xs text-gray-500 truncate block"
                                title={`${activity.lastComment.author ? activity.lastComment.author + ': ' : ''}${activity.lastComment.content}`}
                              >
                                {activity.lastComment.content}
                              </span>
                            ) : <span className="text-xs text-gray-300">—</span>
                          default:
                            return null
                        }
                      }

                      return (
                        <div key={activity.id} className="hover:bg-gray-50/60 transition group">

                          {/* ── Mobile layout ─────────────────────────── */}
                          <div className="md:hidden flex items-center gap-3 px-4 py-2.5">
                            <SelectBox checked={isSel} onChange={() => toggleSelect(activity.id)} />
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
                                <span className="text-sm font-medium text-gray-900 group-hover:text-orange-700 transition block truncate">
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
                              'hidden md:flex items-center gap-2 px-4 py-2 group cursor-grab active:cursor-grabbing',
                              draggingId === activity.id && 'opacity-40',
                              isSel && 'bg-orange-50/60'
                            )}
                          >
                            {/* Checkbox de seleção */}
                            <SelectBox
                              checked={isSel}
                              onChange={() => toggleSelect(activity.id)}
                              className={cn(!isSel && !selectionActive && 'opacity-0 group-hover:opacity-100')}
                            />

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
                                <span className="text-sm font-medium text-gray-900 group-hover:text-orange-700 transition truncate block">
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
                              className="p-1 rounded text-gray-300 hover:text-orange-600 hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition shrink-0"
                            >
                              {isArchivedView ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                            </button>
                          </div>

                        </div>
                      )
                    })}

                    {/* Adicionar tarefa inline no fim do grupo (já neste status) */}
                    {!isArchivedView && (
                      <GroupAddTask
                        listPath={listPath}
                        status={statusCfg.value}
                        campMap={campMap}
                        fixedCampaign={newActivityCampaign}
                      />
                    )}
                  </div>
                )}
              </div>
            )
          })}
          </div>
        )}
      </div>

      {selectionActive && (
        <BulkActionBar
          count={selectedIds.length}
          pending={bulkPending}
          statusConfig={statusConfig}
          members={members}
          isArchivedView={isArchivedView}
          onStatus={bulkApplyStatus}
          onAssignees={bulkApplyAssignees}
          onDates={bulkApplyDates}
          onArchive={bulkApplyArchive}
          onClear={clearSelection}
        />
      )}
    </div>
  )
}

// ── Checkbox de seleção (linha, grupo e cabeçalho) ──────────────────────────
function SelectBox({ checked, indeterminate, onChange, className }: {
  checked: boolean
  indeterminate?: boolean
  onChange: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      draggable={false}
      title={checked ? 'Desmarcar' : 'Selecionar'}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange() }}
      className={cn(
        'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition',
        checked || indeterminate ? 'bg-orange-600 border-orange-600 text-white' : 'border-gray-300 bg-white hover:border-gray-400',
        className,
      )}
    >
      {checked ? <Check className="w-3 h-3" strokeWidth={3} /> : indeterminate ? <Minus className="w-3 h-3" strokeWidth={3} /> : null}
    </button>
  )
}

// ── Barra flutuante de ações em lote ────────────────────────────────────────
function BulkActionBar({
  count, pending, statusConfig, members, isArchivedView,
  onStatus, onAssignees, onDates, onArchive, onClear,
}: {
  count: number
  pending: boolean
  statusConfig: { value: string; label: string; bg: string; text: string }[]
  members: Member[]
  isArchivedView: boolean
  onStatus: (status: string) => void
  onAssignees: (userIds: string[]) => void
  onDates: (start: string | null | undefined, due: string | null | undefined) => void
  onArchive: () => void
  onClear: () => void
}) {
  const [menu, setMenu] = useState<null | 'status' | 'assignee' | 'date'>(null)
  const [start, setStart] = useState('')
  const [due, setDue] = useState('')
  const [pickAssignees, setPickAssignees] = useState<string[]>([])
  const ref = useRef<HTMLDivElement>(null)

  // Ao fechar o menu, descarta a seleção/edição em andamento (evita estado preso).
  function closeMenu() { setMenu(null); setPickAssignees([]); setStart(''); setDue('') }

  useEffect(() => {
    function onOut(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) closeMenu() }
    document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [])

  // Campo de data com o mesmo visual dos demais inputs do app (claro e escuro).
  const dateInputClass = 'mt-1 w-full px-2.5 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-300 transition [color-scheme:light] dark:[color-scheme:dark]'

  return (
    <div ref={ref} className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 animate-[slideUp_0.15s_ease-out]">
      <div className={cn(
        'flex items-center gap-1 rounded-2xl border border-gray-200 bg-white shadow-xl px-2 py-1.5',
        pending && 'opacity-60 pointer-events-none'
      )}>
        <span className="text-sm font-semibold text-gray-800 px-2 tabular-nums whitespace-nowrap">
          {count} selecionada{count !== 1 ? 's' : ''}
        </span>
        <div className="w-px h-5 bg-gray-200 mx-0.5" />

        {/* Status — aplica um status a todas (seleção única faz sentido aqui). */}
        <div className="relative">
          <BarButton icon={Circle} label="Status" active={menu === 'status'} onClick={() => menu === 'status' ? closeMenu() : setMenu('status')} />
          {menu === 'status' && (
            <div className="pop-up absolute bottom-full mb-2 left-0 w-56 bg-white rounded-xl border border-gray-200 shadow-lg py-1.5 max-h-72 overflow-y-auto">
              {statusConfig.map(s => (
                <button key={s.value} type="button"
                  onClick={() => { closeMenu(); onStatus(s.value) }}
                  className="w-full flex items-center px-3 py-1.5 hover:bg-gray-50 transition text-left">
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: s.bg, color: s.text }}>{s.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Responsável — multi-seleção: marque vários e confirme. */}
        <div className="relative">
          <BarButton icon={UserPlus} label="Responsável" active={menu === 'assignee'} onClick={() => menu === 'assignee' ? closeMenu() : setMenu('assignee')} />
          {menu === 'assignee' && (
            <div className="pop-up absolute bottom-full mb-2 left-0 w-60 bg-white rounded-xl border border-gray-200 shadow-lg py-1.5">
              <p className="px-3 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Adicionar responsáveis</p>
              {members.length === 0 ? (
                <p className="px-3 py-2 text-xs text-gray-400">Nenhum membro</p>
              ) : (
                <>
                  <div className="max-h-56 overflow-y-auto">
                    {members.map(m => {
                      const on = pickAssignees.includes(m.userId)
                      return (
                        <button key={m.userId} type="button"
                          onClick={() => setPickAssignees(prev => on ? prev.filter(x => x !== m.userId) : [...prev, m.userId])}
                          className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 transition text-left">
                          <span className={cn('w-4 h-4 rounded border flex items-center justify-center shrink-0', on ? 'bg-orange-600 border-orange-600' : 'border-gray-300')}>
                            {on && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                          </span>
                          <span className="text-sm text-gray-700 truncate">{m.fullName ?? m.email.split('@')[0]}</span>
                        </button>
                      )
                    })}
                  </div>
                  <div className="flex items-center justify-end px-3 pt-2 mt-1 border-t border-gray-100">
                    <button type="button" disabled={pickAssignees.length === 0}
                      onClick={() => { const sel = pickAssignees; closeMenu(); onAssignees(sel) }}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg bg-orange-600 text-[#fff] hover:bg-orange-700 disabled:opacity-50 transition">
                      Adicionar{pickAssignees.length > 0 ? ` (${pickAssignees.length})` : ''}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Prazo — intervalo início → prazo. Campo vazio não altera. */}
        <div className="relative">
          <BarButton icon={Calendar} label="Prazo" active={menu === 'date'} onClick={() => menu === 'date' ? closeMenu() : setMenu('date')} />
          {menu === 'date' && (
            <div className="pop-up absolute bottom-full mb-2 left-0 w-72 bg-white rounded-xl border border-gray-200 shadow-lg p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Início</span>
                  <input type="date" value={start} max={due || undefined} onChange={e => setStart(e.target.value)} className={dateInputClass} />
                </label>
                <label className="block">
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Prazo</span>
                  <input type="date" value={due} min={start || undefined} onChange={e => setDue(e.target.value)} className={dateInputClass} />
                </label>
              </div>
              <p className="text-[11px] text-gray-400">Campo vazio não é alterado.</p>
              <div className="flex items-center justify-between pt-1">
                <button type="button" onClick={() => { closeMenu(); onDates(null, null) }}
                  className="text-xs text-gray-500 hover:text-gray-700 transition">Remover datas</button>
                <button type="button" disabled={!start && !due}
                  onClick={() => { const s = start || undefined; const d = due || undefined; closeMenu(); onDates(s, d) }}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-orange-600 text-[#fff] hover:bg-orange-700 disabled:opacity-50 transition">Aplicar</button>
              </div>
            </div>
          )}
        </div>

        <div className="w-px h-5 bg-gray-200 mx-0.5" />

        <BarButton icon={isArchivedView ? ArchiveRestore : Archive} label={isArchivedView ? 'Desarquivar' : 'Arquivar'} onClick={onArchive} />

        <button type="button" onClick={onClear} title="Limpar seleção"
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

function BarButton({ icon: Icon, label, onClick, active }: {
  icon: ComponentType<{ className?: string }>
  label: string
  onClick: () => void
  active?: boolean
}) {
  return (
    <button type="button" onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg transition',
        active ? 'bg-orange-50 text-orange-700' : 'text-gray-600 hover:bg-gray-100'
      )}>
      <Icon className="w-4 h-4" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

// ── Seletor de status inline (bolinha + dropdown), estilo ClickUp ───────────
function StatusDot({
  current,
  statusConfig,
  onChange,
}: {
  current: string
  statusConfig: { value: string; label: string; bg: string; text: string }[]
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
        style={cfg ? { backgroundColor: cfg.bg, color: cfg.text } : undefined}
        className={cn(
          'w-4 h-4 rounded-full flex items-center justify-center hover:scale-110 transition',
          cfg ? 'ring-1 ring-inset ring-black/10' : 'border-2 border-gray-300 text-gray-300'
        )}
      >
        <Check className="w-2.5 h-2.5" strokeWidth={3.5} />
      </button>

      {open && (
        <div className="pop-in absolute left-0 top-6 z-30 w-56 bg-white rounded-xl border border-gray-200 shadow-lg py-1.5 max-h-72 overflow-y-auto">
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
              <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: s.bg, color: s.text }}>
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
// ── "+ Tarefa" inline no fim de cada grupo de status ────────────────────────
function GroupAddTask({
  listPath,
  status,
  campMap,
  fixedCampaign,
}: {
  listPath: string
  status: string
  campMap: Record<string, CampInfo>
  fixedCampaign?: { workspaceId: string; campaignId: string }
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [camp, setCamp] = useState<{ id: string; label: string } | null>(null)
  const [campOpen, setCampOpen] = useState(false)
  const [q, setQ] = useState('')
  const [pending, startSave] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)
  const campRef = useRef<HTMLDivElement>(null)

  // Em página de campanha a campanha é fixa; na Lista global escolhe-se.
  const campaignId = fixedCampaign?.campaignId ?? camp?.id ?? null
  const canSave = !!title.trim() && !!campaignId

  useEffect(() => {
    if (!campOpen) return
    function onOut(e: MouseEvent) {
      if (campRef.current && !campRef.current.contains(e.target as Node)) setCampOpen(false)
    }
    document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [campOpen])

  function close() { setOpen(false); setTitle(''); setCampOpen(false); setQ('') }

  function submit() {
    if (!canSave || !campaignId || pending) return
    const t = title.trim()
    startSave(async () => {
      const r = await createActivityInline(listPath, campaignId, t, status)
      if (r?.error) { toast.error(r.error); return }
      toast.success('Tarefa criada')
      setTitle('')            // mantém o grupo/campanha p/ adicionar a próxima
      requestAnimationFrame(() => inputRef.current?.focus())
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-gray-400 hover:text-orange-600 hover:bg-gray-50/60 transition"
      >
        <Plus className="w-3.5 h-3.5" /> Tarefa
      </button>
    )
  }

  const items = Object.entries(campMap)
    .map(([id, c]) => ({ id, ...c }))
    .sort((a, b) => a.client.localeCompare(b.client) || a.name.localeCompare(b.name))
  const term = q.trim().toLowerCase()
  const filtered = term ? items.filter(i => `${i.client} ${i.name}`.toLowerCase().includes(term)) : items

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-orange-50/40">
      {/* Seletor de campanha (só na Lista multi-campanha) */}
      {!fixedCampaign && (
        <div className="relative shrink-0" ref={campRef}>
          <button
            type="button"
            onClick={() => setCampOpen(o => !o)}
            className={cn(
              'inline-flex items-center gap-1 max-w-[180px] text-xs rounded-lg border px-2.5 py-1.5 transition',
              camp ? 'border-orange-200 bg-white text-gray-700' : 'border-gray-200 bg-white text-gray-400 hover:border-orange-300'
            )}
          >
            <span className="truncate">{camp ? camp.label : 'Campanha'}</span>
            <ChevronDown className="w-3.5 h-3.5 shrink-0 text-gray-400" />
          </button>
          {campOpen && (
            <div className="pop-in absolute left-0 bottom-full mb-1 w-72 bg-white rounded-xl border border-gray-200 shadow-lg z-30 overflow-hidden">
              <div className="p-2 border-b border-gray-100">
                <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 rounded-lg">
                  <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  <input
                    autoFocus value={q} onChange={e => setQ(e.target.value)}
                    placeholder="Buscar campanha…"
                    className="flex-1 bg-transparent text-sm text-gray-700 placeholder-gray-400 focus:outline-none"
                  />
                </div>
              </div>
              <div className="max-h-60 overflow-y-auto py-1">
                {filtered.length === 0 ? (
                  <p className="px-3 py-6 text-xs text-gray-400 text-center">Nenhuma campanha encontrada</p>
                ) : filtered.map(i => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => { setCamp({ id: i.id, label: `${i.client} / ${i.name}` }); setCampOpen(false); requestAnimationFrame(() => inputRef.current?.focus()) }}
                    className="block w-full text-left px-3 py-2 hover:bg-gray-50 transition"
                  >
                    <span className="text-[11px] text-gray-400 block leading-tight">{i.client}</span>
                    <span className="text-sm text-gray-800">{i.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        autoFocus
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } if (e.key === 'Escape') close() }}
        placeholder="Nome da tarefa…"
        className="flex-1 min-w-0 text-sm bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-500"
      />
      <button type="button" onClick={close} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5 shrink-0">Cancelar</button>
      <button
        type="button"
        onClick={submit}
        disabled={!canSave || pending}
        className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-orange-600 text-[#fff] hover:bg-orange-700 disabled:opacity-50 transition shrink-0"
      >
        {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
        Salvar
      </button>
    </div>
  )
}

function NewActivityButton({
  orgSlug,
  campMap,
  fixedCampaign,
}: {
  orgSlug: string
  campMap: Record<string, CampInfo>
  fixedCampaign?: { workspaceId: string; campaignId: string }
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

  // Página da campanha: vai direto para a criação (sem seletor de campanha).
  if (fixedCampaign) {
    return (
      <Link
        href={`/${orgSlug}/workspaces/${fixedCampaign.workspaceId}/campaigns/${fixedCampaign.campaignId}/activities/new`}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-orange-600 text-[#fff] hover:bg-orange-700 transition"
      >
        <Plus className="w-4 h-4" />
        <span className="hidden sm:inline">Nova atividade</span>
      </Link>
    )
  }

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
        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-orange-600 text-[#fff] hover:bg-orange-700 transition"
      >
        <Plus className="w-4 h-4" />
        <span className="hidden sm:inline">Nova atividade</span>
      </button>

      {open && (
        <div className="pop-in absolute right-0 mt-2 w-72 bg-white rounded-xl border border-gray-200 shadow-lg z-30 overflow-hidden">
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

// ── Link de entregável (Redação / Layout) + botão copiar ────────────────────
function DriveLink({ url, label }: { url: string; label: string }) {
  return (
    <div className="flex items-center gap-1 min-w-0">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        className="inline-flex items-center gap-1 text-xs text-orange-500 hover:text-orange-700 hover:underline min-w-0"
      >
        <ExternalLink className="w-3 h-3 shrink-0" />
        <span className="truncate">{label}</span>
      </a>
      <CopyButton text={url} label={`Copiar link · ${label}`} />
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
          : <span className="text-xs text-gray-300 hover:text-orange-500 transition">+ atribuir</span>}
      </button>
      {open && (
        <div className="pop-in absolute left-0 top-7 z-30 w-56 bg-white rounded-xl border border-gray-200 shadow-lg py-1.5 max-h-64 overflow-y-auto">
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
                <span className={cn('w-4 h-4 rounded border flex items-center justify-center shrink-0', on ? 'bg-orange-600 border-orange-600' : 'border-gray-300')}>
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
        <div className="pop-in absolute left-0 top-7 z-30 w-44 bg-white rounded-xl border border-gray-200 shadow-lg py-1.5">
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

