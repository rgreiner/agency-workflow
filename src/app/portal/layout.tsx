import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: { absolute: 'Painel do cliente — Flow' },
  robots: { index: false, follow: false },
}

/**
 * Casca do portal do cliente: SEMPRE tema claro (o script do layout raiz pode
 * ter ligado o .dark pela preferência do sistema — aqui a gente desliga), fundo
 * neutro e nada da UI interna (sidebar, topnav).
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <script
        dangerouslySetInnerHTML={{
          __html: `document.documentElement.classList.remove('dark')`,
        }}
      />
      {children}
    </div>
  )
}
