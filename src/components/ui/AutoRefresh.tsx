'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Sem mexer na tela por este tempo, a aba é considerada parada. */
const OCIOSO_MS = 5 * 60_000

/**
 * Atualiza os dados do server component periodicamente (router.refresh), pra
 * refletir mudanças feitas por outras pessoas ou em 2º plano (ex.: a revisão de
 * Redação) sem precisar de F5. `fast` acelera o intervalo (usado enquanto a
 * revisão está rodando).
 *
 * Só atualiza quem está OLHANDO: pausa com a aba em background e também com a
 * pessoa parada há mais de 5 min — aba esquecida aberta no fim do dia refazia a
 * página inteira no servidor a cada 20–30 s (medido em 16/10/2026: ~13
 * transações/s no banco com pouca gente usando). Ao voltar (aba visível ou
 * primeiro movimento depois de parada), atualiza na hora para não mostrar dado velho.
 *
 * Padrão de 60 s (era 20 s até 31/10/2026): a tela da tarefa refaz 18 consultas
 * mais as do layout a cada ciclo — três vezes menos refresh para a mesma
 * sensação de "ao vivo", porque quem edita a tarefa vê a própria ação na hora.
 */
export function AutoRefresh({ intervalMs = 60000, fastMs = 4000, fast = false }: {
  intervalMs?: number
  fastMs?: number
  fast?: boolean
}) {
  const router = useRouter()

  useEffect(() => {
    const delay = fast ? fastMs : intervalMs
    let ultimaAtividade = Date.now()
    let perdeuAtualizacao = false
    let timer: ReturnType<typeof setTimeout>

    const visivel = () => typeof document === 'undefined' || document.visibilityState === 'visible'
    // Revisão rodando (`fast`) não espera atividade: o resultado chega sozinho.
    const ociosa = () => !fast && Date.now() - ultimaAtividade > OCIOSO_MS

    function schedule() {
      timer = setTimeout(() => {
        if (visivel() && !ociosa()) router.refresh()
        else perdeuAtualizacao = true
        schedule()
      }, delay)
    }

    function atividade() {
      const estavaOciosa = ociosa()
      ultimaAtividade = Date.now()
      if (estavaOciosa && perdeuAtualizacao && visivel()) { perdeuAtualizacao = false; router.refresh() }
    }
    function aoVoltar() {
      if (visivel() && perdeuAtualizacao) { perdeuAtualizacao = false; ultimaAtividade = Date.now(); router.refresh() }
    }

    const eventos = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
    for (const e of eventos) window.addEventListener(e, atividade, { passive: true })
    document.addEventListener('visibilitychange', aoVoltar)
    schedule()
    return () => {
      clearTimeout(timer)
      for (const e of eventos) window.removeEventListener(e, atividade)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }, [router, intervalMs, fastMs, fast])

  return null
}
