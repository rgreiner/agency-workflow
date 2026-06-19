'use client'

import { useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'

/** Alterna tema claro/escuro (classe .dark no <html> + preferência no localStorage). */
export function ThemeToggle() {
  const [dark, setDark] = useState(false)

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'))
  }, [])

  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try { localStorage.setItem('theme', next ? 'dark' : 'light') } catch {}
  }

  return (
    <button
      onClick={toggle}
      title={dark ? 'Tema claro' : 'Tema escuro'}
      className="text-gray-600 hover:text-gray-300 transition-colors shrink-0"
    >
      {dark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
    </button>
  )
}
