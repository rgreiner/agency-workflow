'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { CheckCheck, Inbox } from 'lucide-react'
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type NotificationItem,
} from '@/app/actions/notifications'
import { messageOf, timeLabel, groupByDay, NotifIcon } from '@/lib/notifications'

export function InboxClient({ orgSlug, initial }: { orgSlug: string; initial: NotificationItem[] }) {
  const router = useRouter()
  const [items, setItems] = useState<NotificationItem[]>(initial)
  const [filter, setFilter] = useState<'todas' | 'nao_lidas'>('todas')

  const load = useCallback(async () => {
    try {
      const r = await getNotifications(orgSlug, 60)
      setItems(r.items)
    } catch { /* tenta de novo no próximo ciclo */ }
  }, [orgSlug])

  // Atualização assíncrona a cada 30s
  useEffect(() => {
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])

  function openItem(n: NotificationItem) {
    if (!n.readAt) {
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x))
      markNotificationRead(n.id)
    }
    if (n.workspaceId && n.campaignId && n.activityId) {
      router.push(`/${orgSlug}/workspaces/${n.workspaceId}/campaigns/${n.campaignId}/activities/${n.activityId}`)
    }
  }

  function markAll() {
    if (items.every(n => n.readAt)) return
    setItems(prev => prev.map(x => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })))
    markAllNotificationsRead(orgSlug)
  }

  const unread = items.filter(n => !n.readAt).length
  const shown = filter === 'nao_lidas' ? items.filter(n => !n.readAt) : items
  const groups = groupByDay(shown)

  return (
    <div className="p-6 max-w-3xl mx-auto">
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
            <button
              onClick={() => setFilter('todas')}
              className={cn('px-2.5 py-1 rounded-md transition', filter === 'todas' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700')}
            >
              Todas
            </button>
            <button
              onClick={() => setFilter('nao_lidas')}
              className={cn('px-2.5 py-1 rounded-md transition', filter === 'nao_lidas' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700')}
            >
              Não lidas
            </button>
          </div>
          {unread > 0 && (
            <button
              onClick={markAll}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"
            >
              <CheckCheck className="w-4 h-4" /> Marcar todas
            </button>
          )}
        </div>
      </div>

      {/* Lista */}
      {shown.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 py-20 text-center">
          <Inbox className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-900 font-medium">
            {filter === 'nao_lidas' ? 'Nenhuma não lida' : 'Caixa de entrada vazia'}
          </p>
          <p className="text-gray-500 text-sm mt-1">
            Avisos de status, comentários e atribuições aparecem aqui.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(group => (
            <div key={group.label}>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 px-1">
                {group.label}
              </p>
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
                {group.items.map(n => (
                  <button
                    key={n.id}
                    onClick={() => openItem(n)}
                    className={cn(
                      'w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 transition',
                      !n.readAt && 'bg-indigo-50/40'
                    )}
                  >
                    <span className="mt-0.5 shrink-0"><NotifIcon type={n.type} className="w-4 h-4" /></span>
                    <span className="flex-1 min-w-0">
                      <span className={cn('block text-sm truncate', n.readAt ? 'font-medium text-gray-700' : 'font-semibold text-gray-900')}>
                        {n.title}
                      </span>
                      <span className="block text-sm text-gray-500 truncate">{messageOf(n)}</span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0 mt-0.5">
                      <span className="text-xs text-gray-400">{timeLabel(n.createdAt)}</span>
                      {!n.readAt && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
