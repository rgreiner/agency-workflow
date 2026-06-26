export default function GanttLoading() {
  return (
    <div className="p-6 animate-pulse">
      <div className="flex items-center justify-between mb-5">
        <div className="space-y-1.5">
          <div className="h-5 bg-gray-200 rounded w-32" />
          <div className="h-3 bg-gray-100 rounded w-44" />
        </div>
        <div className="h-9 bg-gray-100 rounded-lg w-32" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Month header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50/60">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-3 bg-gray-100 rounded flex-1" />
          ))}
        </div>

        {/* Timeline rows with offset bars */}
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="px-4 py-3 border-b border-gray-50 last:border-0">
            <div
              className="h-6 bg-orange-100/70 rounded-md"
              style={{ width: `${25 + ((i * 17) % 45)}%`, marginLeft: `${(i * 13) % 40}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
