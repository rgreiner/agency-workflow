'use client'

import { useEffect } from 'react'

/**
 * Rede de segurança do tema: o script inline aplica `.dark` antes do paint, mas
 * em alguns reloads (hidratação/ordem do Next) a classe pode não persistir.
 * Este efeito reaplica a escolha salva no localStorage após a hidratação, então
 * o tema nunca "some" ao recarregar (Cmd-R / Ctrl-F5).
 */
export function ThemeApplier() {
  useEffect(() => {
    try {
      const t = localStorage.getItem('theme')
      const m = window.matchMedia('(prefers-color-scheme: dark)').matches
      const dark = t === 'dark' || (t !== 'light' && m)
      document.documentElement.classList.toggle('dark', dark)
    } catch { /* localStorage indisponível — ignora */ }
  }, [])
  return null
}
