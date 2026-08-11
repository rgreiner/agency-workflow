/**
 * Esqueleto genérico do Financeiro. Quase toda tela daqui é `force-dynamic`, e
 * sem um loading a navegação fica presa na tela anterior até o servidor
 * responder — o clique parece não ter funcionado. A rota da conta tem o seu
 * próprio (mais parecido com o extrato); este cobre o resto.
 */
export default function FinanceiroLoading() {
  return (
    <div className="p-6 space-y-4 animate-pulse">
      <div className="space-y-2">
        <div className="h-4 bg-gray-200 rounded w-48" />
        <div className="h-3 bg-gray-100 rounded w-72" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-2xl px-4 py-3 space-y-2">
            <div className="h-2.5 bg-gray-100 rounded w-20" />
            <div className="h-4 bg-gray-200 rounded w-24" />
          </div>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl divide-y divide-gray-50">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <div className="h-3 bg-gray-100 rounded w-16 shrink-0" />
            <div className="h-3.5 bg-gray-200 rounded flex-1 max-w-md" />
            <div className="h-3.5 bg-gray-100 rounded w-24 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}
