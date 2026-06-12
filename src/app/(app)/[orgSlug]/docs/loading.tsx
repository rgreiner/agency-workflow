export default function DocsLoading() {
  return (
    <div className="p-8 max-w-4xl mx-auto animate-pulse">
      <div className="flex items-center justify-between mb-8">
        <div className="space-y-2">
          <div className="h-7 bg-gray-200 rounded w-44" />
          <div className="h-3.5 bg-gray-100 rounded w-64" />
        </div>
        <div className="h-9 bg-gray-100 rounded-xl w-40" />
      </div>

      {Array.from({ length: 2 }).map((_, s) => (
        <section key={s} className="mb-8">
          <div className="h-3.5 bg-gray-100 rounded w-28 mb-3" />
          <div className="space-y-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="w-4 h-4 bg-gray-100 rounded shrink-0" />
                <div className="flex-1 h-4 bg-gray-100 rounded max-w-sm" />
                <div className="w-16 h-3 bg-gray-100 rounded" />
                <div className="w-3.5 h-3.5 bg-gray-100 rounded-full" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
