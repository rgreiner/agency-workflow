import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: { absolute: 'Pedido de cotação' },
  robots: { index: false, follow: false },
  // Link vai por WhatsApp/e-mail: o preview não pode mostrar nada do pedido.
  openGraph: null,
}

/**
 * Página do FORNECEDOR: sempre tema claro (é página pública, como relatório) —
 * o script do layout raiz aplicaria o tema salvo de quem já usou o Flow neste
 * navegador.
 */
export default function CotacaoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <script dangerouslySetInnerHTML={{ __html: `document.documentElement.classList.remove('dark')` }} />
      {children}
    </div>
  )
}
