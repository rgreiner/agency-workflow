'use client'

/**
 * "Última interação no Flow" do dia (user_presence_dia, mig. 281) — a dica pra quem
 * esqueceu de bater a saída (ou a entrada). Só sugere; quem decide o horário é a
 * pessoa ou o RH. Sem registro no dia, não aparece nada.
 */
import { useEffect, useState } from 'react'
import { MonitorDot } from 'lucide-react'
import { presencaDosDias } from '@/app/actions/rh-ponto'
import type { PresencaDia } from '@/lib/rh/presenca'
import { cn } from '@/lib/utils'

export function DicaPresenca({ orgSlug, colaboradorId, dia, className }: {
  orgSlug: string; colaboradorId: string
  /** YYYY-MM-DD */
  dia: string
  className?: string
}) {
  // Guardado junto com o dia a que se refere: trocar o dia esconde a dica velha
  // sem precisar zerar estado dentro do efeito.
  const [resp, setResp] = useState<{ dia: string; info: PresencaDia | null } | null>(null)

  useEffect(() => {
    let vivo = true
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return
    presencaDosDias(orgSlug, colaboradorId, [dia]).then(r => {
      if (!vivo) return
      const porDia = 'porDia' in r ? r.porDia : undefined
      setResp({ dia, info: porDia?.[dia] ?? null })
    })
    return () => { vivo = false }
  }, [orgSlug, colaboradorId, dia])

  const info = resp?.dia === dia ? resp.info : null
  if (!info) return null
  return (
    <p className={cn('flex items-center gap-1.5 text-[11px] text-gray-500', className)}
      title="Registrado pelo próprio Flow enquanto a pessoa mexia no sistema (mouse/teclado). Quem trabalha em outro programa no fim do dia pode ter saído depois.">
      <MonitorDot className="w-3.5 h-3.5 text-gray-400 shrink-0" />
      <span>
        No Flow neste dia: primeiro acesso <strong className="text-gray-700">{info.primeiro}</strong>,
        última interação <strong className="text-gray-700">{info.ultimo}</strong>
      </span>
    </p>
  )
}
