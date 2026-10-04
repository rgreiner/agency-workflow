'use client'

import { cn } from '@/lib/utils'
import { formatBRL } from '@/lib/midia'
import type { ComissaoPorCliente, ComissaoReferencia } from '@/lib/producao/comissao-referencia'

const pct = (n: number) => `${String(Number(n.toFixed(2))).replace('.', ',')}%`

/**
 * Comissão de produção por cliente — fora do cubo, de propósito.
 *
 * O cubo da Análise é CAIXA (fin_cubo): o que entrou e saiu. Comissão é
 * atributo do PEDIDO, e misturar as duas fontes numa tabela dinâmica faria a
 * tela responder duas perguntas diferentes com a mesma aparência.
 *
 * Ponderada pelo valor, não média de percentuais: a pergunta é quanto a casa
 * ganha por real faturado naquele cliente.
 */
export function ComissaoPainel({ linhas, referencia }: {
  linhas: ComissaoPorCliente[]; referencia: ComissaoReferencia | null
}) {
  if (linhas.length === 0) return null

  const valor = linhas.reduce((s, l) => s + l.valor, 0)
  const geral = valor > 0 ? linhas.reduce((s, l) => s + l.valor * l.comissaoPct, 0) / valor : 0
  const padrao = referencia?.padrao ?? null

  return (
    <section className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Comissão de produção por cliente</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">
            Ponderada pelo valor dos pedidos{padrao != null && <> · padrão da casa {pct(padrao)}</>}
          </p>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-gray-400">Comissão geral</div>
          <div className="text-lg font-semibold text-emerald-600 tabular-nums">{pct(geral)}</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead>
            <tr className="text-xs font-medium text-gray-400 bg-gray-50/50 border-b border-gray-100">
              <th className="text-left px-4 py-2">Cliente</th>
              <th className="text-right px-4 py-2">Pedidos</th>
              <th className="text-right px-4 py-2">Valor</th>
              <th className="text-right px-4 py-2">Comissão</th>
              <th className="text-right px-4 py-2">Faixa</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {linhas.map(l => {
              // Abaixo do padrão da casa é o que a tela existe para mostrar.
              const abaixo = padrao != null && l.comissaoPct < padrao - 0.01
              return (
                <tr key={l.cliente} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-2.5 text-sm text-gray-900">{l.cliente}</td>
                  <td className="px-4 py-2.5 text-sm text-gray-500 text-right tabular-nums">{l.pedidos}</td>
                  <td className="px-4 py-2.5 text-sm text-gray-700 text-right tabular-nums">{formatBRL(l.valor)}</td>
                  <td className={cn('px-4 py-2.5 text-sm font-medium text-right tabular-nums',
                    abaixo ? 'text-amber-600' : 'text-gray-900')}>{pct(l.comissaoPct)}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-400 text-right tabular-nums">
                    {Math.abs(l.maximo - l.minimo) < 0.01 ? '—' : `${pct(l.minimo)} a ${pct(l.maximo)}`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
