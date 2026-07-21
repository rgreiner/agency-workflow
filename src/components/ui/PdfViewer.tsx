'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft, Download } from 'lucide-react'

/**
 * Visualização de documento: mostra o PRÓPRIO PDF que será enviado.
 *
 * Antes a tela era um HTML parecido com o documento e o PDF nascia do
 * window.print() — duas representações que podiam divergir. Agora existe uma
 * definição só (lib/pdf/*), e o que se vê aqui é byte a byte o que o botão baixa.
 */
export function PdfViewer({ src, fileName, backHref }: { src: string; fileName: string; backHref?: string }) {
  const router = useRouter()
  return (
    <div className="h-full flex flex-col bg-gray-100">
      <div className="shrink-0 flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-100 px-4 py-2.5">
        <button onClick={() => (backHref ? router.push(backHref) : router.back())}
          className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Voltar
        </button>
        <span className="text-xs text-gray-500 truncate hidden sm:block">{fileName}</span>
        {/* `download` + Content-Disposition attachment na rota: baixa sem abrir nada. */}
        <a href={src} download
          className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-lg hover:bg-orange-700 transition-colors active:scale-[0.97]">
          <Download className="w-4 h-4" /> Baixar PDF
        </a>
      </div>
      <iframe src={`${src}?inline=1`} title={fileName} className="flex-1 w-full border-0" />
    </div>
  )
}
