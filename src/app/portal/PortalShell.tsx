import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { PortalThemeToggle } from './PortalThemeToggle'

/**
 * Casca das telas internas do portal (fora do painel): topo com voltar + tema.
 * `wide` para a tela de aprovação, que exibe peças grandes.
 */
export function PortalShell({
  children, wide = false, voltar = { href: '/portal/painel', rotulo: 'Painel' },
}: {
  children: React.ReactNode
  wide?: boolean
  /** Para onde o "voltar" leva (o quadro abre telas também). */
  voltar?: { href: string; rotulo: string }
}) {
  return (
    <div className={`${wide ? 'max-w-3xl' : 'max-w-xl'} mx-auto px-4 py-6 sm:py-10`}>
      <div className="flex items-center justify-between mb-6">
        <Link
          href={voltar.href}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> {voltar.rotulo}
        </Link>
        <PortalThemeToggle />
      </div>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sm:p-8">
        {children}
      </div>
    </div>
  )
}
