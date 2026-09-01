import { MessageSquare, ArrowRightLeft, UserPlus, LogIn, AtSign, FolderSync, AlarmClock, MessageSquareReply, Inbox, BadgeCheck, PenLine } from 'lucide-react'
import { cn } from '@/lib/utils'
import { commentPreview } from '@/lib/html'
import { STATUS_CONFIG, type StatusConfig } from '@/types'
import type { NotificationItem } from '@/app/actions/notifications'

/** `statuses` = cadastro da org (useStatusConfig); sem ele, a lista fixa. */
export function statusLabel(v: unknown, statuses: StatusConfig[] = STATUS_CONFIG) {
  return statuses.find(s => s.value === v)?.label ?? String(v ?? '')
}

/** Prévia guardada em `data.preview`. O comentário é HTML (TipTap) e a caixa
 *  renderiza texto puro — sem isto a tag aparece crua na mensagem. */
function previa(v: unknown): string {
  const t = commentPreview(String(v ?? ''))
  return t ? `: ${t}` : ''
}

export function messageOf(n: NotificationItem, statuses: StatusConfig[] = STATUS_CONFIG): string {
  const actor = n.actorName ?? 'Alguém'
  const to = n.data?.to
  switch (n.type) {
    case 'status_change':  return `${actor} mudou o status${to ? ` para ${statusLabel(to, statuses)}` : ''}`
    case 'entered_status': return `Entrou em ${statusLabel(to, statuses)} — sua etapa`
    case 'new_comment':    return `${actor} comentou${previa(n.data?.preview)}`
    case 'mention':        return `${actor} ${n.data?.all ? 'mencionou todos' : 'mencionou você'}${previa(n.data?.preview)}`
    case 'assigned':       return 'Você foi associado a esta tarefa'
    case 'drive_sync':     return 'Pasta do Drive vinculada — revise o que criar/vincular'
    case 'due_soon':       return '⏰ Vence amanhã — não esqueça'
    case 'portal_resposta': {
      const cli = n.data?.cliente ?? 'O cliente'
      return `${cli} respondeu a pendência${previa(n.data?.preview)}`
    }
    case 'portal_solicitacao': {
      const cli = n.data?.cliente ?? 'Um cliente'
      return `${cli} abriu uma solicitação${n.data?.titulo ? `: ${n.data.titulo}` : ''}`
    }
    case 'portal_aprovado': {
      const cli = n.data?.cliente ?? 'O cliente'
      return `✅ ${cli} APROVOU o trabalho${previa(n.data?.preview)}`
    }
    case 'portal_ajuste': {
      const cli = n.data?.cliente ?? 'O cliente'
      const q = Number(n.data?.pecas ?? 0)
      return `✏️ ${cli} pediu ajustes${q ? ` em ${q} peça${q > 1 ? 's' : ''}` : ''}${previa(n.data?.preview)}`
    }
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
  if (type === 'portal_resposta')    return <MessageSquareReply className={cn(className, 'text-orange-500')} />
  if (type === 'portal_solicitacao') return <Inbox className={cn(className, 'text-orange-500')} />
  if (type === 'portal_aprovado')    return <BadgeCheck className={cn(className, 'text-green-500')} />
  if (type === 'portal_ajuste')      return <PenLine className={cn(className, 'text-orange-500')} />
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
