export default function ActivityLoading() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white animate-pulse">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-6 py-3.5 border-b border-gray-200 shrink-0">
        <div className="h-3 bg-gray-100 rounded w-14" />
        <div className="h-3 bg-gray-100 rounded w-2" />
        <div className="h-3 bg-gray-100 rounded w-20" />
        <div className="h-3 bg-gray-100 rounded w-2" />
        <div className="h-3 bg-gray-100 rounded w-28" />
        <div className="ml-auto h-3 bg-gray-100 rounded w-24" />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Main content */}
        <div className="flex-1 px-8 py-6">
          <div className="max-w-3xl space-y-6">
            <div className="space-y-3">
              <div className="h-7 bg-gray-200 rounded w-2/3" />
              <div className="h-4 bg-gray-100 rounded w-full max-w-lg" />
              <div className="h-4 bg-gray-100 rounded w-3/4 max-w-md" />
            </div>

            {/* Meta strip */}
            <div className="flex items-center gap-3">
              <div className="h-7 bg-gray-100 rounded-lg w-28" />
              <div className="h-7 bg-gray-100 rounded-lg w-36" />
              <div className="h-7 bg-gray-100 rounded-lg w-20" />
              <div className="h-7 bg-gray-100 rounded-full w-7" />
            </div>

            {/* Fields */}
            <div className="space-y-2 pt-4">
              <div className="h-3 bg-gray-100 rounded w-16" />
              <div className="border border-gray-200 rounded-xl divide-y divide-gray-100">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center px-4 py-3.5 gap-4">
                    <div className="h-3 bg-gray-100 rounded w-28 shrink-0" />
                    <div className="h-3 bg-gray-100 rounded w-40" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Feed column — hidden on mobile like the real page */}
        <div className="hidden lg:flex w-[360px] border-l border-gray-200 flex-col shrink-0 bg-gray-50/40">
          <div className="px-5 py-4 border-b border-gray-200 bg-white">
            <div className="h-4 bg-gray-100 rounded w-20" />
          </div>
          <div className="p-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 bg-gray-100 rounded-full shrink-0" />
                  <div className="h-3 bg-gray-100 rounded w-24" />
                </div>
                <div className="h-3 bg-gray-100 rounded w-full" />
                <div className="h-3 bg-gray-100 rounded w-2/3" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
