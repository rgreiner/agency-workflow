'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Download, ArrowLeft } from 'lucide-react'

/**
 * Barra fixa (não impressa) com "Baixar PDF" e voltar.
 *
 * O nome do arquivo salvo vem do `document.title` — é assim que o navegador
 * nomeia o PDF na impressão. Por isso o título é trocado enquanto a página de
 * impressão está aberta e devolvido ao sair: sem isso o arquivo saía com o nome
 * da rota ("Flow — One a One").
 */
export function PrintToolbar({ backHref, fileName }: { backHref?: string; fileName?: string }) {
  const router = useRouter()

  useEffect(() => {
    if (!fileName) return
    const anterior = document.title
    // Barra quebraria o nome em pasta em alguns sistemas.
    document.title = fileName.replace(/[/\\]/g, '-').trim()
    return () => { document.title = anterior }
  }, [fileName])

  return (
    <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-3 bg-gray-100 border-b border-gray-200 px-4 py-2.5">
      <button onClick={() => (backHref ? router.push(backHref) : router.back())}
        className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition">
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>
      <button onClick={() => window.print()}
        className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-lg hover:bg-orange-700 transition">
        <Download className="w-4 h-4" /> Baixar PDF
      </button>
    </div>
  )
}
