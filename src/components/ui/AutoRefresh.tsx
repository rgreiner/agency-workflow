'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Atualiza os dados do server component periodicamente (router.refresh), pra
 * refletir mudanças feitas por outras pessoas ou em 2º plano (ex.: a revisão de
 * Redação) sem precisar de F5. Pausa quando a aba está em background; `fast`
 * acelera o intervalo (usado enquanto a revisão está rodando).
 */
export function AutoRefresh({ intervalMs = 10000, fastMs = 4000, fast = false }: {
  intervalMs?: number
  fastMs?: number
  fast?: boolean
}) {
  const router = useRouter()

  useEffect(() => {
    const delay = fast ? fastMs : intervalMs
    let timer: ReturnType<typeof setTimeout>
    function schedule() {
      timer = setTimeout(() => {
        if (typeof document === 'undefined' || document.visibilityState === 'visible') {
          router.refresh()
        }
        schedule()
      }, delay)
    }
    schedule()
    return () => clearTimeout(timer)
  }, [router, intervalMs, fastMs, fast])

  return null
}
