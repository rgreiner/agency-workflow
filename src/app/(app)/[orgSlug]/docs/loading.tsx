/** Espelha o início de Documentos: título + CTA e a lista única de Recentes. */
export default function DocsLoading() {
  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-3xl mx-auto animate-pulse">
      <div className="flex items-start justify-between mb-8">
        <div className="space-y-2">
          <div className="h-7 bg-gray-200 rounded w-44" />
          <div className="h-3.5 bg-gray-100 rounded w-64" />
        </div>
        <div className="h-9 bg-gray-100 rounded-xl w-40" />
      </div>
      <div className="h-3 bg-gray-100 rounded w-20 mb-3" />
      <div className="rounded-2xl border border-gray-200 divide-y divide-gray-100">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <div className="w-4 h-4 bg-gray-100 rounded shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-4 bg-gray-100 rounded max-w-xs" />
              <div className="h-3 bg-gray-100 rounded w-24" />
            </div>
            <div className="w-10 h-3 bg-gray-100 rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}
