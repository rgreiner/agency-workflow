import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: { absolute: 'Painel do cliente — Flow' },
  robots: { index: false, follow: false },
}

/**
 * Casca do portal do cliente: tema PRÓPRIO (chave portal-theme, independente da
 * preferência do membro — o ThemeApplier global ignora /portal), com toggle
 * claro/escuro nas telas. Default sem escolha salva = tema do sistema.
 * Nada da UI interna (sidebar, topnav).
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){try{var t=localStorage.getItem('portal-theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',t==='dark'||(t!=='light'&&m))}catch(e){}})()`,
        }}
      />
      {children}
    </div>
  )
}
