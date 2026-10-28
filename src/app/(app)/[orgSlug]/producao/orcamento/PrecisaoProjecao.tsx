import { formatBRL } from '@/lib/midia'
import { calibrar, registrados, type HistoricoCotacao } from '@/lib/cotacao-historico'

const pct = (x: number) => `${x > 0 ? '+' : ''}${Math.round(x * 100)}%`

/**
 * "A projeção acerta?" — para cada pedido já feito, o que a projeção teria dito no dia
 * (só com o histórico anterior, sem o próprio orçamento) contra o custo real do pedido.
 * Mostra por tipo de fornecedor onde a agência mais erra o custo; quando o erro é
 * consistente (5+ pedidos para o mesmo lado), a projeção passa a se corrigir sozinha.
 */
export function PrecisaoProjecao({ historico }: { historico: HistoricoCotacao | null }) {
  const { pares, porTipo } = calibrar(historico)
  const regs = registrados(historico)
  if (!pares.length && !regs.length) return null
  const acima = regs.filter(r => r.desvio > 0)
  const naoCobertos = acima.filter(r => r.desvio > r.margem)
  const piores = [...pares].sort((a, b) => Math.abs(b.erro) - Math.abs(a.erro)).slice(0, 5)
  return (
    <details className="mx-6 mb-6 bg-white rounded-2xl border border-gray-200 p-5 group">
      <summary className="cursor-pointer list-none flex items-center justify-between gap-3">
        <span>
          <span className="text-sm font-semibold text-gray-900">Projeção de custo × custo real</span>
          <span className="block text-xs text-gray-500 mt-0.5">{pares.length} pedido(s) comparados com a projeção que o histórico daria no dia</span>
        </span>
        <span className="text-xs text-gray-400 group-open:hidden">ver</span>
      </summary>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-[11px] font-medium text-gray-400 text-left">
            <th className="py-1 pr-3">Tipo</th><th className="py-1 pr-3 text-right">Pedidos</th>
            <th className="py-1 pr-3 text-right">Real × projeção (mediana)</th><th className="py-1 pr-3 text-right">Erro típico</th><th className="py-1">Correção</th>
          </tr></thead>
          <tbody>
            {porTipo.map(t => (
              <tr key={t.tipo} className="border-t border-gray-50">
                <td className="py-1.5 pr-3 text-gray-800">{t.tipo}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{t.n}</td>
                <td className={`py-1.5 pr-3 text-right tabular-nums ${t.vies > 0.05 ? 'text-red-600' : t.vies < -0.05 ? 'text-emerald-700' : 'text-gray-600'}`}>{pct(t.vies)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-gray-600">±{Math.round(t.erroMedio * 100)}%</td>
                <td className="py-1.5 text-xs text-gray-500">{t.fator ? `aplicada (${pct(t.fator - 1)})` : t.n < 5 ? 'pouca base ainda' : 'erro sem padrão'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs font-medium text-gray-500 mt-4 mb-1">Maiores diferenças</p>
        <ul className="space-y-0.5 text-xs text-gray-600">
          {piores.map((p, i) => (
            <li key={i}>{p.documento ? `${p.documento} · ` : ''}<span className="text-gray-800">{p.item}</span> · {p.fornecedor} · {p.quant.toLocaleString('pt-BR')} un: projeção {formatBRL(p.projetado)}, real {formatBRL(p.real)} <b className={p.erro > 0 ? 'text-red-600' : 'text-emerald-700'}>{pct(p.erro)}</b></li>
          ))}
        </ul>
        <p className="text-[11px] text-gray-400 mt-3">Positivo = o pedido saiu mais caro que a projeção. A correção só entra quando 5+ pedidos do tipo erram para o mesmo lado.</p>

        <p className="text-xs font-medium text-gray-500 mt-5 mb-1">Registrado na aprovação {regs.length ? `(${regs.length} item(ns))` : ''}</p>
        {regs.length ? (
          <>
            <p className="text-xs text-gray-600 mb-2">
              {acima.length} item(ns) saíram acima da projeção, somando {formatBRL(acima.reduce((t, r) => t + r.desvio, 0))};
              {' '}{naoCobertos.length ? <b className="text-red-600">{naoCobertos.length} passaram da margem negociada</b> : 'a margem negociada cobriu todos'}.
            </p>
            <ul className="space-y-0.5 text-xs text-gray-600">
              {[...regs].sort((a, b) => b.desvio - a.desvio).slice(0, 8).map((r, i) => (
                <li key={i}>{r.documento ? `${r.documento} · ` : ''}<span className="text-gray-800">{r.item}</span> · {r.quant.toLocaleString('pt-BR')} un:
                  {' '}projeção {formatBRL(r.projetado)}{r.orcado ? `, orçado ${formatBRL(r.orcado)}` : ''}, real {formatBRL(r.real)}
                  {' '}→ <b className={r.desvio > r.margem ? 'text-red-600' : r.desvio > 0 ? 'text-amber-700' : 'text-emerald-700'}>{r.desvio >= 0 ? '+' : ''}{formatBRL(r.desvio)}</b>
                  <span className="text-gray-400"> · margem {formatBRL(r.margem)}</span></li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-xs text-gray-400">A partir de agora, ao gerar os PPs de um orçamento a projeção do dia fica gravada no item. Aqui aparece o desvio de custo da época e se a margem (comissão + honorários) cobriu.</p>
        )}
      </div>
    </details>
  )
}
