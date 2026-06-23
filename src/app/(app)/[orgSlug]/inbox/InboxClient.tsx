'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { CheckCheck, Inbox, Check, Trash2, X } from 'lucide-react'
import {
  getNotifications,
  markNotificationRead,
  markNotificationsRead,
  markAllNotificationsRead,
  deleteNotifications,
  type NotificationItem,
} from '@/app/actions/notifications'
import { messageOf, timeLabel, groupByDay, NotifIcon } from '@/lib/notifications'

export function InboxClient({ orgSlug, initial }: { orgSlug: string; initial: NotificationItem[] }) {
  const router = useRouter()
  const [items, setItems] = useState<NotificationItem[]>(initial)
  const [filter, setFilter] = useState<'todas' | 'nao_lidas'>('todas')
  const [selected, setSelected] = useState<Set<string>>(new Set())

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

  function toggleSelect(id: string) {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function openItem(n: NotificationItem) {
    if (!n.readAt) {
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x))
      markNotificationRead(n.id)
    }
    if (n.workspaceId && n.campaignId && n.activityId) {
      router.push(`/${orgSlug}/workspaces/${n.workspaceId}/campaigns/${n.campaignId}/activities/${n.activityId}`)
    }
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

  const unread = items.filter(n => !n.readAt).length
  const shown = filter === 'nao_lidas' ? items.filter(n => !n.readAt) : items
  const groups = groupByDay(shown)
  const selCount = selected.size
  const allShownSelected = shown.length > 0 && shown.every(n => selected.has(n.id))
  function toggleSelectAll() {
    setSelected(allShownSelected ? new Set() : new Set(shown.map(n => n.id)))
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
        <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-indigo-50 border border-indigo-100 rounded-xl">
          <span className="text-sm font-medium text-indigo-800">{selCount} selecionada{selCount !== 1 ? 's' : ''}</span>
          <div className="flex-1" />
          <button onClick={() => markRead([...selected])}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg text-indigo-700 hover:bg-indigo-100 transition">
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
          <span className={cn('w-4 h-4 rounded border flex items-center justify-center shrink-0 transition', allShownSelected ? 'bg-indigo-600 border-indigo-600 text-[#fff]' : 'border-gray-300')}>
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
                {group.items.map(n => {
                  const isSel = selected.has(n.id)
                  return (
                    <div
                      key={n.id}
                      className={cn(
                        'group relative flex items-center gap-2 px-3 transition',
                        isSel ? 'bg-indigo-50/70' : !n.readAt ? 'bg-indigo-50/40 hover:bg-gray-50' : 'hover:bg-gray-50'
                      )}
                    >
                      {/* Checkbox (hover/selecionado) */}
                      <button
                        onClick={() => toggleSelect(n.id)}
                        title="Selecionar"
                        className={cn(
                          'w-4 h-4 shrink-0 rounded border flex items-center justify-center transition',
                          isSel ? 'bg-indigo-600 border-indigo-600 opacity-100'
                                : 'border-gray-300 opacity-0 group-hover:opacity-100'
                        )}
                      >
                        {isSel && <Check className="w-2.5 h-2.5 text-white" />}
                      </button>

                      {/* Conteúdo clicável (abre a tarefa) */}
                      <button onClick={() => openItem(n)} className="flex-1 min-w-0 flex items-center gap-3 py-3 text-left">
                        <NotifIcon type={n.type} className="w-4 h-4 shrink-0" />
                        <span className={cn('shrink-0 max-w-[34%] truncate text-sm', n.readAt ? 'font-medium text-gray-700' : 'font-semibold text-gray-900')}>
                          {n.title}
                        </span>
                        <span className="flex-1 min-w-0 truncate text-sm text-gray-500">{messageOf(n)}</span>
                        <span className="shrink-0 text-xs text-gray-400 pr-1">{timeLabel(n.createdAt)}</span>
                      </button>

                      {/* Ações no hover */}
                      <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                        {!n.readAt && (
                          <button onClick={() => markRead([n.id])} title="Marcar como lida"
                            className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-white transition">
                            <Check className="w-4 h-4" />
                          </button>
                        )}
                        <button onClick={() => remove([n.id])} title="Apagar"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-white transition">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
