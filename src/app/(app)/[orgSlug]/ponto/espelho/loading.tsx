/** Esqueleto do espelho (sem ele, a navegação a partir do ponto mostraria o esqueleto de lá). */
export default function MeuEspelhoLoading() {
  return (
    <div className="p-4 sm:p-6 max-w-4xl motion-safe:animate-pulse" aria-busy="true" aria-label="Carregando o espelho">
      <div className="h-4 bg-gray-100 rounded w-24 mb-4" />
      <div className="space-y-1.5 mb-5">
        <div className="h-6 bg-gray-200 rounded w-56 max-w-full" />
        <div className="h-3 bg-gray-100 rounded w-48" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-gray-200 bg-white p-3 space-y-2">
            <div className="h-2.5 bg-gray-100 rounded w-16" />
            <div className="h-5 bg-gray-200 rounded w-12" />
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-gray-50 last:border-0">
            <div className="h-3 bg-gray-100 rounded w-14" />
            <div className="h-3 bg-gray-100 rounded w-40" />
            <div className="h-3 bg-gray-100 rounded w-10 ml-auto" />
          </div>
        ))}
      </div>
    </div>
  )
}
