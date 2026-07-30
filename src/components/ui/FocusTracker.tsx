'use client'

import { useEffect, useRef } from 'react'
import { registrarFoco, focoPing } from '@/app/actions/horas'

/**
 * Apontamento de horas SEM apontar (migration 166).
 *
 * Marca a abertura da tarefa e mantém um sinal de vida enquanto a aba está
 * visível. O tempo é calculado no banco: da abertura desta tarefa até a próxima
 * abertura, dentro do ponto do dia.
 *
 * Roda uma vez por tarefa aberta — o `AutoRefresh` (router.refresh a cada 20s)
 * atualiza o server component mas NÃO remonta este client component. A RPC ainda
 * dedupla aberturas repetidas em 90s, como segunda trava.
 *
 * O ping só sai com a aba visível: sessão que correu sem sinal de vida é o que
 * alimenta a coluna "sem sinal" do relatório (tarefa esquecida aberta).
 */
export function FocusTracker({ activityId, origem }: {
  activityId: string
  origem: 'modal' | 'pagina'
}) {
  const focoId = useRef<string | null>(null)

  useEffect(() => {
    let vivo = true
    focoId.current = null

    registrarFoco(activityId, origem).then(id => {
      if (vivo) focoId.current = id
    })

    const ping = () => {
      if (focoId.current && document.visibilityState === 'visible') focoPing(focoId.current)
    }
    const timer = setInterval(ping, 120_000)
    document.addEventListener('visibilitychange', ping)

    return () => {
      vivo = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', ping)
    }
  }, [activityId, origem])

  return null
}
