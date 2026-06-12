export default function BoardsLoading() {
  return (
    <div className="p-6 animate-pulse">
      <div className="flex items-center justify-between mb-6">
        <div className="space-y-1.5">
          <div className="h-5 bg-gray-200 rounded w-36" />
          <div className="h-3 bg-gray-100 rounded w-72" />
        </div>
        <div className="h-9 bg-gray-100 rounded-xl w-32" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-40 rounded-2xl border border-gray-200 bg-white overflow-hidden">
            <div className="h-[68%] bg-gray-50" />
            <div className="px-3.5 py-3 border-t border-gray-100 space-y-2">
              <div className="h-4 bg-gray-100 rounded w-3/4" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
