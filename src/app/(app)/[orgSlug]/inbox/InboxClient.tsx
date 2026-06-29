'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { CheckCheck, Inbox, Check, Trash2, X, ChevronDown, ChevronRight } from 'lucide-react'
import {
  getNotifications,
  markNotificationsRead,
  markAllNotificationsRead,
  deleteNotifications,
  type NotificationItem,
} from '@/app/actions/notifications'
import { messageOf, timeLabel, groupByDay, NotifIcon } from '@/lib/notifications'

/** Entrada da lista: uma notificação ou um grupo de notificações da mesma tarefa. */
interface Entry { key: string; items: NotificationItem[] }

export function InboxClient({ orgSlug, initial }: { orgSlug: string; initial: NotificationItem[] }) {
  const router = useRouter()
  const [items, setItems] = useState<NotificationItem[]>(initial)
  const [filter, setFilter] = useState<'todas' | 'nao_lidas'>('todas')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    try {
      const r = await getNotifications(orgSlug, 60)
      setItems(r.items)
    } catch { /* tenta de novo no próximo ciclo */ }
  }, [orgSlug])

  useEffect(() => {
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])

  function toggleSelectMany(ids: string[]) {
    setSelected(prev => {
      const n = new Set(prev)
      const allSel = ids.every(i => n.has(i))
      ids.forEach(i => (allSel ? n.delete(i) : n.add(i)))
      return n
    })
  }

  function navigateTo(n: NotificationItem) {
    if (n.type === 'drive_sync' && n.workspaceId && n.campaignId) {
      router.push(`/${orgSlug}/workspaces/${n.workspaceId}/campaigns/${n.campaignId}?drive=sync`)
      return
    }
    if (n.workspaceId && n.campaignId && n.activityId) {
      const from = encodeURIComponent(`/${orgSlug}/inbox`)
      router.push(`/${orgSlug}/workspaces/${n.workspaceId}/campaigns/${n.campaignId}/activities/${n.activityId}?from=${from}`)
    }
  }

  /** Abre a tarefa do grupo e marca todas as suas notificações como lidas. */
  function openEntry(entryItems: NotificationItem[]) {
    const unreadIds = entryItems.filter(i => !i.readAt).map(i => i.id)
    if (unreadIds.length) {
      const now = new Date().toISOString()
      setItems(prev => prev.map(x => unreadIds.includes(x.id) ? { ...x, readAt: x.readAt ?? now } : x))
      markNotificationsRead(unreadIds)
    }
    navigateTo(entryItems[0])
  }

  function markRead(ids: string[]) {
    if (!ids.length) return
    const now = new Date().toISOString()
    setItems(prev => prev.map(x => ids.includes(x.id) ? { ...x, readAt: x.readAt ?? now } : x))
    markNotificationsRead(ids)
    setSelected(new Set())
  }

  function remove(ids: string[]) {
    if (!ids.length) return
    setItems(prev => prev.filter(x => !ids.includes(x.id)))
    deleteNotifications(ids)
    setSelected(prev => { const n = new Set(prev); ids.forEach(i => n.delete(i)); return n })
  }

  function markAll() {
    if (items.every(n => n.readAt)) return
    const now = new Date().toISOString()
    setItems(prev => prev.map(x => ({ ...x, readAt: x.readAt ?? now })))
    markAllNotificationsRead(orgSlug)
  }

  function toggleExpand(key: string) {
    setExpanded(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })
  }

  const unread = items.filter(n => !n.readAt).length
  const shown = filter === 'nao_lidas' ? items.filter(n => !n.readAt) : items
  const groups = groupByDay(shown)
  const selCount = selected.size
  const allShownSelected = shown.length > 0 && shown.every(n => selected.has(n.id))
  function toggleSelectAll() {
    setSelected(allShownSelected ? new Set() : new Set(shown.map(n => n.id)))
  }

  // Consolida notificações da MESMA tarefa (activityId) numa entrada só,
  // preservando a ordem (posição do item mais recente do grupo).
  function entriesOf(groupItems: NotificationItem[]): Entry[] {
    const byActivity = new Map<string, NotificationItem[]>()
    for (const n of groupItems) {
      if (!n.activityId) continue
      const arr = byActivity.get(n.activityId) ?? []
      arr.push(n); byActivity.set(n.activityId, arr)
    }
    const seen = new Set<string>()
    const entries: Entry[] = []
    for (const n of groupItems) {
      if (n.activityId) {
        if (seen.has(n.activityId)) continue
        seen.add(n.activityId)
        entries.push({ key: n.activityId, items: byActivity.get(n.activityId)! })
      } else {
        entries.push({ key: n.id, items: [n] })
      }
    }
    return entries
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Caixa de entrada</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {unread > 0 ? `${unread} não lida${unread !== 1 ? 's' : ''}` : 'Tudo em dia'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
            <button onClick={() => setFilter('todas')}
              className={cn('px-2.5 py-1 rounded-md transition', filter === 'todas' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700')}>
              Todas
            </button>
            <button onClick={() => setFilter('nao_lidas')}
              className={cn('px-2.5 py-1 rounded-md transition', filter === 'nao_lidas' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700')}>
              Não lidas
            </button>
          </div>
          {unread > 0 && (
            <button onClick={markAll}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition">
              <CheckCheck className="w-4 h-4" /> Marcar tudo como lida
            </button>
          )}
        </div>
      </div>

      {/* Barra de seleção em lote */}
      {selCount > 0 && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-orange-50 border border-orange-100 rounded-xl">
          <span className="text-sm font-medium text-orange-800">{selCount} selecionada{selCount !== 1 ? 's' : ''}</span>
          <div className="flex-1" />
          <button onClick={() => markRead([...selected])}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg text-orange-700 hover:bg-orange-100 transition">
            <Check className="w-4 h-4" /> Marcar como lida
          </button>
          <button onClick={() => remove([...selected])}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg text-red-600 hover:bg-red-50 transition">
            <Trash2 className="w-4 h-4" /> Apagar
          </button>
          <button onClick={() => setSelected(new Set())}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-white transition" title="Limpar seleção">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Selecionar todas */}
      {shown.length > 0 && (
        <button onClick={toggleSelectAll}
          className="flex items-center gap-2 mb-3 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors">
          <span className={cn('w-4 h-4 rounded border flex items-center justify-center shrink-0 transition', allShownSelected ? 'bg-orange-600 border-orange-600 text-[#fff]' : 'border-gray-300')}>
            {allShownSelected && <Check className="w-3 h-3" strokeWidth={3} />}
          </span>
          {allShownSelected ? 'Desmarcar todas' : `Selecionar todas (${shown.length})`}
        </button>
      )}

      {/* Lista */}
      {shown.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 py-20 text-center">
          <Inbox className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-900 font-medium">
            {filter === 'nao_lidas' ? 'Nenhuma não lida' : 'Caixa de entrada vazia'}
          </p>
          <p className="text-gray-500 text-sm mt-1">Avisos de status, comentários e atribuições aparecem aqui.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(group => (
            <div key={group.label}>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 px-1">
                {group.label}
              </p>
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
                {entriesOf(group.items).map(entry => (
                  <EntryRow
                    key={entry.key}
                    entry={entry}
                    selected={selected}
                    expanded={expanded.has(entry.key)}
                    onToggleExpand={() => toggleExpand(entry.key)}
                    onToggleSelect={toggleSelectMany}
                    onOpen={openEntry}
                    onMarkRead={markRead}
                    onRemove={remove}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function EntryRow({ entry, selected, expanded, onToggleExpand, onToggleSelect, onOpen, onMarkRead, onRemove }: {
  entry: Entry
  selected: Set<string>
  expanded: boolean
  onToggleExpand: () => void
  onToggleSelect: (ids: string[]) => void
  onOpen: (items: NotificationItem[]) => void
  onMarkRead: (ids: string[]) => void
  onRemove: (ids: string[]) => void
}) {
  const its = entry.items
  const head = its[0]
  const ids = its.map(i => i.id)
  const isGroup = its.length > 1
  const isSel = ids.every(i => selected.has(i))
  const anyUnread = its.some(i => !i.readAt)

  return (
    <div>
      <div className={cn('group relative flex items-center gap-2 px-3 transition',
        isSel ? 'bg-orange-50/70' : anyUnread ? 'bg-orange-50/40 hover:bg-gray-50' : 'hover:bg-gray-50')}>
        {/* Checkbox */}
        <button onClick={() => onToggleSelect(ids)} title="Selecionar"
          className={cn('w-4 h-4 shrink-0 rounded border flex items-center justify-center transition',
            isSel ? 'bg-orange-600 border-orange-600 opacity-100' : 'border-gray-300 opacity-0 group-hover:opacity-100')}>
          {isSel && <Check className="w-2.5 h-2.5 text-white" />}
        </button>

        {/* Conteúdo clicável (abre a tarefa) */}
        <button onClick={() => onOpen(its)} className="flex-1 min-w-0 flex items-center gap-3 py-3 text-left">
          <NotifIcon type={head.type} className="w-4 h-4 shrink-0" />
          <span className={cn('shrink-0 max-w-[34%] truncate text-sm', anyUnread ? 'font-semibold text-gray-900' : 'font-medium text-gray-700')}>
            {head.title}
          </span>
          <span className="flex-1 min-w-0 truncate text-sm text-gray-500">{messageOf(head)}</span>
          {isGroup && (
            <span className="shrink-0 text-[11px] font-medium text-orange-700 bg-orange-100 rounded-full px-2 py-0.5">
              {its.length} atualizações
            </span>
          )}
          <span className="shrink-0 text-xs text-gray-400 pr-1">{timeLabel(head.createdAt)}</span>
        </button>

        {/* Expandir grupo */}
        {isGroup && (
          <button onClick={onToggleExpand} title={expanded ? 'Recolher' : 'Ver atualizações'}
            className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-white transition">
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        )}

        {/* Ações no hover */}
        <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
          {anyUnread && (
            <button onClick={() => onMarkRead(ids)} title="Marcar como lida"
              className="p-1.5 rounded-lg text-gray-400 hover:text-orange-600 hover:bg-white transition">
              <Check className="w-4 h-4" />
            </button>
          )}
          <button onClick={() => onRemove(ids)} title="Apagar"
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-white transition">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Atualizações do grupo (expandido) */}
      {isGroup && expanded && (
        <div className="bg-gray-50/60 border-t border-gray-100">
          {its.map(n => (
            <button key={n.id} onClick={() => onOpen([n])}
              className="w-full flex items-center gap-3 pl-11 pr-3 py-2 text-left hover:bg-white transition">
              <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', n.readAt ? 'bg-gray-300' : 'bg-orange-500')} />
              <span className="flex-1 min-w-0 truncate text-sm text-gray-600">{messageOf(n)}</span>
              <span className="shrink-0 text-xs text-gray-400">{timeLabel(n.createdAt)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
