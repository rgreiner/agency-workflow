import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: { absolute: 'Cadastro de fornecedor' },
  robots: { index: false, follow: false },
  // Link vai por WhatsApp/e-mail: o preview não mostra nada do cadastro.
  openGraph: null,
}

/** Página do FORNECEDOR: sempre tema claro, como a da cotação. */
export default function CadastroFornecedorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <script dangerouslySetInnerHTML={{ __html: `document.documentElement.classList.remove('dark')` }} />
      {children}
    </div>
  )
}
