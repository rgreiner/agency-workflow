export default function MembrosLoading() {
  return (
    <div className="animate-pulse">
      <div className="flex items-center justify-between mb-6">
        <div className="h-4 bg-gray-100 rounded w-28" />
        <div className="h-9 bg-gray-100 rounded-lg w-36" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full min-w-[480px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              {['Pessoa', 'Cargo', 'Papel'].map(h => (
                <th key={h} className="text-left px-4 py-3">
                  <div className="h-3 bg-gray-100 rounded w-16" />
                </th>
              ))}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gray-200" />
                    <div className="space-y-1.5">
                      <div className="h-3.5 bg-gray-200 rounded w-28" />
                      <div className="h-2.5 bg-gray-100 rounded w-36" />
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="h-7 bg-gray-100 rounded-lg w-28" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-7 bg-gray-100 rounded-lg w-24" />
                </td>
                <td className="px-3 py-3">
                  <div className="w-6 h-6 bg-gray-100 rounded-lg" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
