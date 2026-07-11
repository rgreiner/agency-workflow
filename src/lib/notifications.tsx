import { MessageSquare, ArrowRightLeft, UserPlus, LogIn, AtSign, FolderSync, AlarmClock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { STATUS_CONFIG } from '@/types'
import type { NotificationItem } from '@/app/actions/notifications'

export function statusLabel(v: unknown) {
  return STATUS_CONFIG.find(s => s.value === v)?.label ?? String(v ?? '')
}

export function messageOf(n: NotificationItem): string {
  const actor = n.actorName ?? 'Alguém'
  const to = n.data?.to
  switch (n.type) {
    case 'status_change':  return `${actor} mudou o status${to ? ` para ${statusLabel(to)}` : ''}`
    case 'entered_status': return `Entrou em ${statusLabel(to)} — sua etapa`
    case 'new_comment':    return `${actor} comentou${n.data?.preview ? `: ${n.data.preview}` : ''}`
    case 'mention':        return `${actor} ${n.data?.all ? 'mencionou todos' : 'mencionou você'}${n.data?.preview ? `: ${n.data.preview}` : ''}`
    case 'assigned':       return 'Você foi associado a esta tarefa'
    case 'drive_sync':     return 'Pasta do Drive vinculada — revise o que criar/vincular'
    case 'due_soon':       return '⏰ Vence amanhã — não esqueça'
    default:               return 'Atualização'
  }
}

export function NotifIcon({ type, className = 'w-3.5 h-3.5' }: { type: string; className?: string }) {
  if (type === 'new_comment')    return <MessageSquare className={cn(className, 'text-sky-500')} />
  if (type === 'mention')        return <AtSign className={cn(className, 'text-pink-500')} />
  if (type === 'assigned')       return <UserPlus className={cn(className, 'text-violet-500')} />
  if (type === 'entered_status') return <LogIn className={cn(className, 'text-emerald-500')} />
  if (type === 'drive_sync')     return <FolderSync className={cn(className, 'text-amber-500')} />
  if (type === 'due_soon')       return <AlarmClock className={cn(className, 'text-red-500')} />
  return <ArrowRightLeft className={cn(className, 'text-orange-500')} />
}

export function dayLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const yest = new Date(now); yest.setDate(now.getDate() - 1)
  if (sameDay(d, now)) return 'Hoje'
  if (sameDay(d, yest)) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

/** Agrupa notificações (já ordenadas desc) por dia. */
export function groupByDay(items: NotificationItem[]): { label: string; items: NotificationItem[] }[] {
  const groups: { label: string; items: NotificationItem[] }[] = []
  for (const n of items) {
    const label = dayLabel(n.createdAt)
    const g = groups.find(x => x.label === label)
    if (g) g.items.push(n)
    else groups.push({ label, items: [n] })
  }
  return groups
}
