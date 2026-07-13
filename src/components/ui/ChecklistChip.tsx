import { CheckSquare } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Pílula de progresso do checklist (3/7). Verde quando completo. Some se vazio. */
export function ChecklistChip({ done, total, className }: { done: number; total: number; className?: string }) {
  if (!total) return null
  const complete = done >= total
  return (
    <span
      title={`Checklist: ${done} de ${total} concluído${done === 1 ? '' : 's'}`}
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium tabular-nums',
        complete ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500',
        className,
      )}
    >
      <CheckSquare className="w-3 h-3 shrink-0" />
      {done}/{total}
    </span>
  )
}
