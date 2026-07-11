import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(date))
}

// Prazo = 19h (horário LOCAL) do dia da entrega — a pessoa tem o dia todo pra
// terminar. Sem isto, `new Date('YYYY-MM-DD')` vira meia-noite UTC = 21h da
// véspera em Brasília, e a tarefa aparecia atrasada/no dia errado.
export const DEADLINE_HOUR = 19

/** Meia-noite LOCAL do dia da data 'YYYY-MM-DD' (evita o off-by-one de fuso). */
export function parseDateLocal(dueDate: string | null): Date | null {
  if (!dueDate) return null
  const [y, m, d] = dueDate.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d, 0, 0, 0, 0)
}

/** Instante-limite (19h local) do dia da entrega, ou null. */
export function deadlineAt(dueDate: string | null): Date | null {
  const d = parseDateLocal(dueDate)
  if (d) d.setHours(DEADLINE_HOUR, 0, 0, 0)
  return d
}

export function isOverdue(dueDate: string | null): boolean {
  const dl = deadlineAt(dueDate)
  return dl ? new Date() > dl : false
}

/** Diferença em DIAS DE CALENDÁRIO (hoje=0, amanhã=1, ontem=-1). */
export function daysUntil(dueDate: string | null): number | null {
  const due = parseDateLocal(dueDate)
  if (!due) return null
  const now = new Date()
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((due.getTime() - today0.getTime()) / 86_400_000)
}

/** Rótulo do prazo p/ badges (Hoje · Amanhã · Xd · Nd atraso). */
export function dueLabel(dueDate: string | null): string | null {
  const days = daysUntil(dueDate)
  if (days === null) return null
  if (isOverdue(dueDate)) return days === 0 ? 'Hoje' : `${Math.abs(days)}d atraso`
  return days === 0 ? 'Hoje' : days === 1 ? 'Amanhã' : `${days}d`
}

export function formatDistanceToNow(date: string | Date): string {
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'agora'
  if (mins < 60) return `${mins}min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d`
  return formatDate(date)
}
