export default function ListaLoading() {
  return (
    <div className="p-6 animate-pulse">
      <div className="flex items-center justify-between mb-5">
        <div className="space-y-1.5">
          <div className="h-5 bg-gray-200 rounded w-40" />
          <div className="h-3 bg-gray-100 rounded w-28" />
        </div>
        <div className="h-9 bg-gray-100 rounded-lg w-24" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-gray-50/60">
          <div className="flex-1" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-3 bg-gray-100 rounded w-20" />
          ))}
          <div className="w-32 h-3 bg-gray-100 rounded" />
        </div>

        {/* Groups */}
        {Array.from({ length: 3 }).map((_, g) => (
          <div key={g} className="border-b border-gray-100 last:border-0">
            <div className="flex items-center gap-2 px-4 py-2.5">
              <div className="w-3.5 h-3.5 bg-gray-100 rounded" />
              <div className="h-5 bg-gray-100 rounded-full w-24" />
              <div className="h-3 bg-gray-100 rounded w-4" />
            </div>
            {Array.from({ length: 3 }).map((_, r) => (
              <div key={r} className="flex items-center gap-2 px-4 py-3 border-t border-gray-50">
                <div className="flex-1 space-y-1">
                  <div className="h-3 bg-gray-100 rounded w-24" />
                  <div className="h-3.5 bg-gray-100 rounded w-56" />
                </div>
                <div className="w-16 h-6 bg-gray-100 rounded-full" />
                <div className="w-16 h-5 bg-gray-100 rounded" />
                <div className="w-20 h-5 bg-gray-100 rounded-full" />
                <div className="w-14 h-5 bg-gray-100 rounded-md" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
