import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { PortalThemeToggle } from './PortalThemeToggle'

/** Casca das telas internas do portal (fora do painel): topo com voltar + tema. */
export function PortalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-xl mx-auto px-4 py-6 sm:py-10">
      <div className="flex items-center justify-between mb-6">
        <Link
          href="/portal/painel"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Painel
        </Link>
        <PortalThemeToggle />
      </div>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sm:p-8">
        {children}
      </div>
    </div>
  )
}
