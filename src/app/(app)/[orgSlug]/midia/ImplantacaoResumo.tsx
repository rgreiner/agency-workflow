import Link from 'next/link'
import { AlertTriangle, ArrowRight, ListChecks } from 'lucide-react'

export interface ImplantacaoRow {
  workspaceId: string; cliente: string
  pct: number; ok: number; vale: number; perdidos: number
}

/**
 * Só o que exige ação: cliente 100% implantado e sem item perdido não aparece.
 * Um painel que lista tudo vira decoração — o radar é o que falta.
 */
export function ImplantacaoResumo({ orgSlug, clientes }: { orgSlug: string; clientes: ImplantacaoRow[] }) {
  if (clientes.length === 0) return null
  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-gray-400" /> Implantação incompleta
        </h2>
        <Link href={`/${orgSlug}/midia/clientes`}
          className="text-xs font-medium text-orange-600 hover:text-orange-700 transition-colors inline-flex items-center gap-1">
          resolver <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
      <ul className="space-y-2">
        {clientes.slice(0, 8).map(c => (
          <li key={c.workspaceId} className="flex items-center gap-3">
            <span className="text-sm text-gray-700 min-w-0 flex-1 truncate">{c.cliente}</span>
            {c.perdidos > 0 && (
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700 shrink-0 inline-flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> {c.perdidos} perdido{c.perdidos > 1 ? 's' : ''}
              </span>
            )}
            <span className="text-[11px] text-gray-400 tabular-nums shrink-0 w-16 text-right">{c.ok} de {c.vale}</span>
            <span className="w-24 h-2 rounded-full bg-gray-100 overflow-hidden shrink-0">
              <span className="block h-full rounded-full bg-orange-500" style={{ width: `${Math.max(c.pct, 2)}%` }} />
            </span>
            <span className="text-[11px] font-medium text-gray-600 tabular-nums shrink-0 w-9 text-right">{c.pct}%</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
