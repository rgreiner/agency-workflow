import Link from 'next/link'
import { AlertTriangle, ArrowRight, Truck } from 'lucide-react'

export interface EntregaResumoRow {
  id: string; titulo: string; cliente: string; veiculo: string | null
  prazoEnvio: string | null; conflito: boolean
  tarefaTitulo: string | null; materialPronto: boolean
}

const fmt = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : 'sem prazo')

/** As 6 entregas mais urgentes — o resto mora em /midia/entregas. */
export function EntregasResumo({ orgSlug, entregas }: { orgSlug: string; entregas: EntregaResumoRow[] }) {
  if (entregas.length === 0) return null
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
  const proximas = entregas.slice(0, 6)

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-2">
          <Truck className="w-4 h-4 text-gray-400" /> Próximas entregas
        </h2>
        <Link href={`/${orgSlug}/midia/entregas`}
          className="text-xs font-medium text-orange-600 hover:text-orange-700 transition-colors inline-flex items-center gap-1">
          ver todas ({entregas.length}) <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
      <ul className="space-y-1.5">
        {proximas.map(e => {
          const vencida = !!e.prazoEnvio && e.prazoEnvio.slice(0, 10) < hoje
          return (
            <li key={e.id} className="flex items-center gap-2.5 flex-wrap py-1.5 border-b border-gray-50 last:border-0">
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-lg tabular-nums shrink-0 ${
                vencida ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                {fmt(e.prazoEnvio)}
              </span>
              <span className="text-sm text-gray-800 min-w-0 flex-1 truncate">{e.titulo}</span>
              <span className="text-[11px] text-gray-400 shrink-0">{e.cliente}{e.veiculo ? ` · ${e.veiculo}` : ''}</span>
              {!e.materialPronto && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 shrink-0">
                  com a criação
                </span>
              )}
              {e.conflito && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700 shrink-0 inline-flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> conflito
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
