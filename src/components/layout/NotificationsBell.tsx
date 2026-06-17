'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, MessageSquare, ArrowRightLeft, UserPlus, LogIn, Inbox, CheckCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { STATUS_CONFIG } from '@/types'
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type NotificationItem,
} from '@/app/actions/notifications'

const POLL_MS = 30_000

function statusLabel(v: unknown) {
  return STATUS_CONFIG.find(s => s.value === v)?.label ?? String(v ?? '')
}

function messageOf(n: NotificationItem): string {
  const actor = n.actorName ?? 'Alguém'
  const to = n.data?.to
  switch (n.type) {
    case 'status_change':   return `${actor} mudou o status${to ? ` para ${statusLabel(to)}` : ''}`
    case 'entered_status':  return `Entrou em ${statusLabel(to)} — sua etapa`
    case 'new_comment':     return `${actor} comentou${n.data?.preview ? `: ${n.data.preview}` : ''}`
    case 'assigned':        return 'Você foi associado a esta tarefa'
    default:                return 'Atualização'
  }
}

function IconFor({ type }: { type: string }) {
  const cls = 'w-3.5 h-3.5'
  if (type === 'new_comment')  return <MessageSquare className={cn(cls, 'text-sky-500')} />
  if (type === 'assigned')     return <UserPlus className={cn(cls, 'text-violet-500')} />
  if (type === 'entered_status') return <LogIn className={cn(cls, 'text-emerald-500')} />
  return <ArrowRightLeft className={cn(cls, 'text-indigo-500')} />
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const yest = new Date(now); yest.setDate(now.getDate() - 1)
  if (sameDay(d, now)) return 'Hoje'
  if (sameDay(d, yest)) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function NotificationsBell({ orgSlug }: { orgSlug: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unread, setUnread] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const r = await getNotifications(orgSlug)
      setItems(r.items)
      setUnread(r.unread)
    } catch { /* silencioso — tenta de novo no próximo ciclo */ }
  }, [orgSlug])

  // Carrega ao montar + polling a cada 30s (atualização assíncrona em segundo plano)
  useEffect(() => {
    load()
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [load])

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return
    function onOut(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [open])

  function openItem(n: NotificationItem) {
    setOpen(false)
    if (!n.readAt) {
      setUnread(u => Math.max(0, u - 1))
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x))
      markNotificationRead(n.id)
    }
    if (n.workspaceId && n.campaignId && n.activityId) {
      router.push(`/${orgSlug}/workspaces/${n.workspaceId}/campaigns/${n.campaignId}/activities/${n.activityId}`)
    }
  }

  function markAll() {
    if (unread === 0) return
    setUnread(0)
    setItems(prev => prev.map(x => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })))
    markAllNotificationsRead(orgSlug)
  }

  // Agrupa por dia mantendo ordem (já vem desc do servidor)
  const groups: { label: string; items: NotificationItem[] }[] = []
  for (const n of items) {
    const label = dayLabel(n.createdAt)
    const g = groups.find(x => x.label === label)
    if (g) g.items.push(n)
    else groups.push({ label, items: [n] })
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => { setOpen(o => !o); if (!open) load() }}
        className="relative flex items-center p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
        title="Caixa de entrada"
        aria-label="Notificações"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl border border-gray-200 shadow-lg z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100">
            <span className="text-sm font-semibold text-gray-800">Caixa de entrada</span>
            {unread > 0 && (
              <button
                onClick={markAll}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-indigo-600 transition"
              >
                <CheckCheck className="w-3.5 h-3.5" /> Marcar todas
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Inbox className="w-7 h-7 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">Nada por aqui ainda.</p>
              </div>
            ) : (
              groups.map(group => (
                <div key={group.label}>
                  <p className="px-3 pt-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                    {group.label}
                  </p>
                  {group.items.map(n => (
                    <button
                      key={n.id}
                      onClick={() => openItem(n)}
                      className={cn(
                        'w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-gray-50 transition',
                        !n.readAt && 'bg-indigo-50/40'
                      )}
                    >
                      <span className="mt-0.5 shrink-0"><IconFor type={n.type} /></span>
                      <span className="flex-1 min-w-0">
                        <span className={cn('block text-sm truncate', n.readAt ? 'font-medium text-gray-700' : 'font-semibold text-gray-900')}>{n.title}</span>
                        <span className="block text-xs text-gray-500 truncate">{messageOf(n)}</span>
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0 mt-0.5">
                        <span className="text-[10px] text-gray-400">{timeLabel(n.createdAt)}</span>
                        {!n.readAt && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />}
                      </span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
