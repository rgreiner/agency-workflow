export default function WorkspacesLoading() {
  return (
    <div className="p-6 animate-pulse">
      <div className="flex items-center justify-between mb-5">
        <div className="h-5 bg-gray-200 rounded w-36" />
        <div className="h-9 bg-gray-100 rounded-lg w-28" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-3 h-3 rounded-full bg-gray-200" />
              <div className="h-4 bg-gray-200 rounded w-32" />
            </div>
            <div className="space-y-2 mb-4">
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="h-3 bg-gray-100 rounded w-full" />
              ))}
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              <div className="h-3 bg-gray-100 rounded w-20" />
              <div className="h-3 bg-gray-100 rounded w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
