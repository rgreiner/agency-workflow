/**
 * Esqueleto da tela do ponto. No celular a aba "Ponto" parecia não responder
 * até o servidor devolver a página — o toque precisa de resposta na hora.
 */
export default function PontoLoading() {
  return (
    <div className="p-4 sm:p-6 max-w-2xl motion-safe:animate-pulse" aria-busy="true" aria-label="Carregando o ponto">
      <div className="space-y-1.5 mb-4 sm:mb-5">
        <div className="h-5 bg-gray-200 rounded w-32" />
        <div className="h-3 bg-gray-100 rounded w-64 max-w-full" />
      </div>
      <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
        <div className="flex gap-2 mb-4">
          <div className="h-12 w-20 bg-gray-100 rounded-xl" />
          <div className="h-12 w-20 bg-gray-100 rounded-xl" />
        </div>
        <div className="h-14 sm:h-12 bg-gray-200 rounded-xl" />
      </div>
      <div className="mt-5 rounded-2xl border border-gray-200 bg-white overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
            <div className="h-3 bg-gray-100 rounded w-16" />
            <div className="h-3 bg-gray-100 rounded w-40" />
            <div className="h-3 bg-gray-100 rounded w-10" />
          </div>
        ))}
      </div>
    </div>
  )
}
