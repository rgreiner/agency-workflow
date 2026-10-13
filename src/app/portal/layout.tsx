import type { Metadata } from 'next'
import { Eye } from 'lucide-react'
import { sessaoPortal } from '@/lib/auth/portal'
import { sairPortal } from '@/app/actions/portal'

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
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  // "Ver como cliente" (mig. 342): faixa fixa para a agência nunca esquecer que
  // está na visão do cliente — e o caminho de volta ao Flow.
  const preview = (await sessaoPortal())?.preview === true
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){try{var t=localStorage.getItem('portal-theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',t==='dark'||(t!=='light'&&m))}catch(e){}})()`,
        }}
      />
      {preview && (
        <div className="sticky top-0 z-40 bg-gray-900 text-[#fff] text-sm">
          <div className="max-w-5xl mx-auto px-4 py-2 flex items-center gap-2">
            <Eye className="w-4 h-4 shrink-0" />
            <span className="flex-1 min-w-0 truncate">Você está vendo o painel como o cliente vê. Só leitura.</span>
            <form action={sairPortal}>
              <button type="submit" className="shrink-0 font-medium underline underline-offset-2 hover:no-underline">
                Voltar ao Flow
              </button>
            </form>
          </div>
        </div>
      )}
      {children}
    </div>
  )
}
