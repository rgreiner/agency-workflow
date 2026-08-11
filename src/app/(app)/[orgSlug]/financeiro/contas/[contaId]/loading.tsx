/**
 * Sem este arquivo o clique no card da conta não dava sinal nenhum: a rota é
 * `force-dynamic`, então o Next segura a navegação até o servidor terminar e a
 * tela anterior fica parada — lê-se como "o link não funciona".
 *
 * O esqueleto repete o cabeçalho + os cards de saldo + a lista do extrato, na
 * mesma largura da tela real, pra nada pular de lugar quando o dado chega.
 */
export default function ContaLoading() {
  return (
    <div className="animate-pulse">
      <div className="p-6 pb-0">
        <div className="h-3.5 bg-gray-100 rounded w-20 mb-4" />
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gray-200" />
            <div className="space-y-1.5">
              <div className="h-4 bg-gray-200 rounded w-40" />
              <div className="h-3 bg-gray-100 rounded w-24" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-9 bg-gray-100 rounded-xl w-56" />
            <div className="h-9 bg-gray-100 rounded-xl w-32" />
          </div>
        </div>
      </div>

      <div className="p-6 space-y-4">
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
    </div>
  )
}
