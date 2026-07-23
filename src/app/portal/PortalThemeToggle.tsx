'use client'

import { useSyncExternalStore } from 'react'
import { Moon, Sun } from 'lucide-react'

/**
 * Tema do portal (independente do tema do membro): alterna a classe .dark e
 * persiste em `portal-theme`. O default (sem escolha salva) segue o sistema —
 * aplicado pelo script inline do layout do portal, antes do paint.
 * A fonte da verdade é a CLASSE no <html> (observada via MutationObserver) —
 * sem estado duplicado no React.
 */
function subscribe(onChange: () => void) {
  const obs = new MutationObserver(onChange)
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => obs.disconnect()
}

export function PortalThemeToggle({ className = '' }: { className?: string }) {
  const dark = useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains('dark'),
    () => false, // snapshot no servidor — o script inline acerta antes do paint
  )

  function toggle() {
    const next = !dark
    document.documentElement.classList.toggle('dark', next)
    try { localStorage.setItem('portal-theme', next ? 'dark' : 'light') } catch { /* ignora */ }
  }

  return (
    <button
      onClick={toggle}
      title={dark ? 'Tema claro' : 'Tema escuro'}
      aria-label={dark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
      className={`p-2 rounded-xl text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors ${className}`}
    >
      {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  )
}
