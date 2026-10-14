import Link from 'next/link'
import { LayoutDashboard, Columns3 } from 'lucide-react'

/** Alterna entre as duas visões do cliente: Painel (decisões) e Quadro (por fase). */
export function PortalNav({ atual }: { atual: 'painel' | 'quadro' }) {
  const item = (chave: 'painel' | 'quadro', href: string, rotulo: string, Icone: typeof Columns3) => (
    <Link
      href={href}
      aria-current={atual === chave ? 'page' : undefined}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        atual === chave ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
      }`}
    >
      <Icone className="w-4 h-4" /> <span className="hidden sm:inline">{rotulo}</span>
    </Link>
  )
  return (
    <nav className="inline-flex items-center gap-0.5 p-0.5 rounded-xl bg-gray-100">
      {item('painel', '/portal/painel', 'Painel', LayoutDashboard)}
      {item('quadro', '/portal/quadro', 'Quadro', Columns3)}
    </nav>
  )
}
