/** Esqueleto da Caixa de entrada — aba do celular: o toque precisa de resposta na hora. */
export default function InboxLoading() {
  return (
    <div className="p-4 md:p-6 motion-safe:animate-pulse" aria-busy="true" aria-label="Carregando a caixa de entrada">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 md:mb-5">
        <div className="space-y-1.5">
          <div className="h-5 bg-gray-200 rounded w-40" />
          <div className="h-3 bg-gray-100 rounded w-20" />
        </div>
        <div className="h-8 bg-gray-100 rounded-lg w-40" />
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-3 border-b border-gray-50 last:border-0">
            <div className="w-4 h-4 bg-gray-100 rounded" />
            <div className="h-3 bg-gray-200 rounded w-24 shrink-0" />
            <div className="h-3 bg-gray-100 rounded flex-1" />
            <div className="h-3 bg-gray-100 rounded w-10" />
          </div>
        ))}
      </div>
    </div>
  )
}
