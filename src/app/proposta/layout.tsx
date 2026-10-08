import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: { absolute: 'Proposta de trabalho' },
  robots: { index: false, follow: false },
  // O link vai por e-mail/WhatsApp: o preview não pode mostrar salário nem cargo.
  openGraph: null,
}

/**
 * Página do CANDIDATO: sempre tema claro (é pública, como o relatório e a
 * cotação) — o script do layout raiz aplicaria o tema salvo de quem já usou o
 * Flow neste navegador.
 */
export default function PropostaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <script dangerouslySetInnerHTML={{ __html: `document.documentElement.classList.remove('dark')` }} />
      {children}
    </div>
  )
}
