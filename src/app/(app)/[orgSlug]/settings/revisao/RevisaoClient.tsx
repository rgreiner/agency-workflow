'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { FileText, Palette, PackageCheck, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { setOrgReviewGates, type ReviewGates } from '@/app/actions/org-settings'

const GATES: { key: keyof ReviewGates; label: string; icon: typeof FileText; desc: string }[] = [
  {
    key: 'redacao',
    label: 'Redação',
    icon: FileText,
    desc: 'Ao avançar a tarefa a partir de Redação, a IA revisa o texto do Doc de Redação (ortografia e gramática).',
  },
  {
    key: 'design',
    label: 'Design',
    icon: Palette,
    desc: 'Ao avançar a partir de Design, a IA revisa a ortografia das peças do Preview e cruza com o texto aprovado na Redação.',
  },
  {
    key: 'finalizacao',
    label: 'Finalização',
    icon: PackageCheck,
    desc: 'Ao avançar a partir de Finalização, a IA revisa a ortografia do arquivo final (imagem/PDF).',
  },
]

export function RevisaoClient({ orgSlug, orgId, initial }: { orgSlug: string; orgId: string; initial: ReviewGates }) {
  const [gates, setGates] = useState<ReviewGates>(initial)
  const [, start] = useTransition()

  function toggle(key: keyof ReviewGates) {
    const next = { ...gates, [key]: !gates[key] }
    const prev = gates
    setGates(next) // otimista; reverte se falhar
    start(async () => {
      const res = await setOrgReviewGates(orgSlug, orgId, next)
      if (res?.error) {
        setGates(prev)
        toast.error(res.error)
      } else {
        toast.success(next[key] ? `Revisão de ${GATES.find(g => g.key === key)!.label} ligada.` : `Revisão de ${GATES.find(g => g.key === key)!.label} desligada.`)
      }
    })
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900 inline-flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-orange-500" /> Revisão por IA
        </h2>
        <p className="text-gray-500 text-sm mt-0.5">
          Ligue ou desligue a revisão automática em cada etapa. Desligada, a tarefa avança direto, sem análise nem comentário.
        </p>
      </div>

      <ul className="space-y-2 max-w-2xl">
        {GATES.map(({ key, label, icon: Icon, desc }) => (
          <li key={key} className="flex items-start gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3">
            <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', gates[key] ? 'text-orange-500' : 'text-gray-300')} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900">{label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={gates[key]}
              aria-label={`Revisão de ${label}`}
              onClick={() => toggle(key)}
              className={cn(
                // Track desligado: gray-300 + ring — gray-200 no dark é a cor do
                // card e o seletor "some" (fica só a bolinha branca solta).
                'relative shrink-0 w-10 h-6 rounded-full transition-colors active:scale-[0.97] ring-1 ring-inset',
                gates[key] ? 'bg-orange-600 ring-transparent' : 'bg-gray-300 ring-gray-400/30',
              )}
            >
              <span className={cn(
                'absolute top-0.5 w-5 h-5 rounded-full bg-[#fff] shadow transition-transform',
                gates[key] ? 'translate-x-[18px]' : 'translate-x-0.5',
              )} />
            </button>
          </li>
        ))}
      </ul>

      <p className="text-xs text-gray-400 mt-4 max-w-2xl">
        A mudança vale para as próximas movimentações de status — revisões já em andamento não são afetadas.
      </p>
    </div>
  )
}
