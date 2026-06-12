export default function CampaignLoading() {
  return (
    <div className="p-6 animate-pulse">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-4">
        <div className="h-3 bg-gray-100 rounded w-14" />
        <div className="h-3 bg-gray-100 rounded w-2" />
        <div className="h-3 bg-gray-100 rounded w-24" />
        <div className="h-3 bg-gray-100 rounded w-2" />
        <div className="h-3 bg-gray-100 rounded w-32" />
      </div>

      <div className="flex items-center justify-between mb-5">
        <div className="h-6 bg-gray-200 rounded w-56" />
        <div className="h-9 bg-gray-100 rounded-lg w-36" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {Array.from({ length: 3 }).map((_, g) => (
          <div key={g} className="border-b border-gray-100 last:border-0">
            <div className="flex items-center gap-2 px-4 py-2 bg-gray-50/70 border-b border-gray-100">
              <div className="h-5 bg-gray-100 rounded-full w-28" />
              <div className="h-3 bg-gray-100 rounded w-4" />
            </div>
            {Array.from({ length: 3 }).map((_, r) => (
              <div key={r} className="flex items-center gap-4 px-4 py-3 border-t border-gray-50 first:border-0">
                <div className="flex-1 h-4 bg-gray-100 rounded max-w-md" />
                <div className="w-10 h-6 bg-gray-100 rounded-full" />
                <div className="w-14 h-4 bg-gray-100 rounded" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
