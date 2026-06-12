export default function AtendimentoLoading() {
  return (
    <div className="p-6 animate-pulse">
      <div className="flex items-center justify-between mb-5">
        <div className="space-y-1.5">
          <div className="h-5 bg-gray-200 rounded w-48" />
          <div className="h-3 bg-gray-100 rounded w-36" />
        </div>
        <div className="h-9 bg-gray-100 rounded-xl w-28" />
      </div>

      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, g) => (
          <div key={g} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="w-4 h-4 bg-gray-100 rounded" />
              <div className="h-6 bg-gray-100 rounded-full w-32" />
              <div className="h-3 bg-gray-100 rounded w-4" />
            </div>
            {Array.from({ length: 2 }).map((_, r) => (
              <div key={r} className="flex items-center gap-4 px-4 py-3 border-t border-gray-50">
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 bg-gray-100 rounded w-32" />
                  <div className="h-4 bg-gray-100 rounded w-64" />
                </div>
                <div className="w-14 h-6 bg-gray-100 rounded-full" />
                <div className="w-24 h-4 bg-gray-100 rounded" />
                <div className="w-12 h-4 bg-gray-100 rounded" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
