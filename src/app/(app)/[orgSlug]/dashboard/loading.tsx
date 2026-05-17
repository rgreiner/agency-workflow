export default function DashboardLoading() {
  return (
    <div className="p-6 animate-pulse">
      {/* WeeklyProgress hero skeleton */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-5 flex items-center gap-6">
        <div className="w-20 h-20 rounded-full bg-gray-100 shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-gray-100 rounded w-48" />
          <div className="h-2 bg-gray-100 rounded w-full" />
          <div className="h-3 bg-gray-100 rounded w-32" />
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="w-9 h-9 rounded-lg bg-gray-100 mb-3" />
            <div className="h-7 bg-gray-100 rounded w-12 mb-1" />
            <div className="h-3 bg-gray-100 rounded w-24" />
          </div>
        ))}
      </div>

      {/* Task list */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-5">
        <div className="h-4 bg-gray-100 rounded w-28 mb-4" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2.5">
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 bg-gray-100 rounded w-3/4" />
              <div className="h-2.5 bg-gray-100 rounded w-1/2" />
            </div>
            <div className="h-5 bg-gray-100 rounded-full w-16" />
          </div>
        ))}
      </div>

      {/* Bottom grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="h-4 bg-gray-100 rounded w-36 mb-4" />
            {Array.from({ length: 4 }).map((_, j) => (
              <div key={j} className="flex items-center gap-3 mb-2.5">
                <div className="h-5 bg-gray-100 rounded-full w-32" />
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full" />
                <div className="h-4 bg-gray-100 rounded w-4" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
