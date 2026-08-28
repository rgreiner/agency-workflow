'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Target, AlertTriangle, Info } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { carregarMargemCliente, type MargemCliente } from '@/app/actions/fin-margem'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const brlCurto = (v: number) => Math.abs(v) >= 1000
  ? `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`
  : brl(v)
const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

/** Períodos em regime de CAIXA. O mês isolado engana (o fee entra num mês e o
 *  trabalho acontece no outro), por isso o padrão são 3 meses. */
function periodo(chave: string, hoje: string): { ini: string; fim: string } {
  const [y, m, d] = hoje.split('-').map(Number)
  const fim = hoje
  if (chave === 'mes') return { ini: `${hoje.slice(0, 7)}-01`, fim }
  const meses = chave === '12m' ? 12 : chave === '6m' ? 6 : 3
  const ini = new Date(y, m - 1 - (meses - 1), 1)
  void d
  return { ini: `${ini.getFullYear()}-${String(ini.getMonth() + 1).padStart(2, '0')}-01`, fim }
}
const OPCOES = [
  { v: 'mes', l: 'Mês atual' },
  { v: '3m', l: 'Últimos 3 meses' },
  { v: '6m', l: 'Últimos 6 meses' },
  { v: '12m', l: 'Últimos 12 meses' },
]

export function MargemClient({ orgSlug, hoje }: { orgSlug: string; hoje: string }) {
  const [faixa, setFaixa] = useState('3m')
  const [dados, setDados] = useState<{ linhas: MargemCliente[]; margemAlvo: number } | null>(null)
  const [loading, setLoading] = useState(true)

  const { ini, fim } = useMemo(() => periodo(faixa, hoje), [faixa, hoje])

  const carregar = useCallback(async () => {
    setLoading(true)
    const r = await carregarMargemCliente(orgSlug, ini, fim)
    if (r.error || !r.linhas) { toast.error(r.error ?? 'Falha ao calcular a margem'); setDados(null) }
    else setDados({ linhas: r.linhas, margemAlvo: r.margemAlvo ?? 20 })
    setLoading(false)
  }, [orgSlug, ini, fim])

  useEffect(() => { carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  const alvo = dados?.margemAlvo ?? 20
  // A agência entra à parte: receita/custo da casa não é margem de cliente.
  const clientes = useMemo(() => (dados?.linhas ?? []).filter(l => !l.agencia), [dados])
  const casa = useMemo(() => (dados?.linhas ?? []).filter(l => l.agencia), [dados])

  const total = useMemo(() => clientes.reduce((a, l) => ({
    receita: a.receita + l.receita, imposto: a.imposto + l.imposto,
    custo_horas: a.custo_horas + l.custo_horas, custo_direto: a.custo_direto + l.custo_direto,
    margem: a.margem + l.margem, horas: a.horas + l.horas,
  }), { receita: 0, imposto: 0, custo_horas: 0, custo_direto: 0, margem: 0, horas: 0 }), [clientes])
  const margemTotalPct = total.receita > 0 ? (total.margem / total.receita) * 100 : null

  const abaixo = clientes.filter(l => l.receita > 0 && (l.margem_pct ?? 0) < alvo)
  const semReceita = clientes.filter(l => l.receita === 0 && l.custo_horas > 0)

  /** Cor da margem contra o alvo: no alvo, perto (≥ metade) ou abaixo. */
  const corPct = (pct: number | null) =>
    pct == null ? 'text-gray-400'
      : pct >= alvo ? 'text-emerald-600'
      : pct >= alvo / 2 ? 'text-amber-600'
      : 'text-red-600'

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Target className="w-5 h-5 text-orange-600" /> Margem por cliente
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            O que entrou menos o que custou o tempo dedicado a cada cliente.
            {dados && <> Período <b className="text-gray-700">{dataBR(ini)} – {dataBR(fim)}</b> · alvo <b className="text-gray-700">{alvo}%</b></>}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1">
          {OPCOES.map(o => (
            <button key={o.v} onClick={() => setFaixa(o.v)}
              className={cn('px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                faixa === o.v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800')}>
              {o.l}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Calculando…</div>
      ) : !clientes.length ? (
        <div className="text-center py-16 text-gray-400 text-sm">Nenhuma receita ou hora no período.</div>
      ) : (<>
        {/* Resumo */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500 mb-1">Receita de clientes</p>
            <p className="text-xl font-semibold tabular-nums text-gray-900">{brl(total.receita)}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">recebido no período</p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500 mb-1">Custo do tempo</p>
            <p className="text-xl font-semibold tabular-nums text-gray-900">{brl(total.custo_horas)}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{total.horas.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}h em tarefas</p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500 mb-1">Imposto + custo direto</p>
            <p className="text-xl font-semibold tabular-nums text-gray-900">{brl(total.imposto + total.custo_direto)}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{brl(total.imposto)} imposto · {brl(total.custo_direto)} produção</p>
          </div>
          <div className={cn('rounded-2xl border p-4',
            margemTotalPct != null && margemTotalPct >= alvo ? 'border-emerald-100 bg-emerald-50/50' : 'border-orange-100 bg-orange-50/50')}>
            <p className="text-xs text-gray-500 mb-1">Margem realizada</p>
            <p className={cn('text-xl font-semibold tabular-nums', corPct(margemTotalPct))}>
              {margemTotalPct != null ? `${margemTotalPct.toFixed(1)}%` : '—'}
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">{brl(total.margem)} · alvo {alvo}%</p>
          </div>
        </div>

        {!!abaixo.length && (
          <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 px-4 py-3 mb-4 text-sm text-amber-900 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <b>{abaixo.length} cliente(s) abaixo do alvo de {alvo}%</b>
              <div className="text-xs mt-0.5">
                {abaixo.map(l => `${l.cliente} (${l.margem_pct?.toFixed(0)}%)`).join(' · ')}
              </div>
            </div>
          </div>
        )}

        {/* Tabela */}
        <div className="rounded-2xl border border-gray-200 bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 text-xs text-gray-400">
              <th className="text-left px-4 py-3 font-medium">Cliente</th>
              <th className="text-right px-3 py-3 font-medium">Receita</th>
              <th className="text-right px-3 py-3 font-medium">Imposto</th>
              <th className="text-right px-3 py-3 font-medium">Horas</th>
              <th className="text-right px-3 py-3 font-medium">Custo do tempo</th>
              <th className="text-right px-3 py-3 font-medium">Produção</th>
              <th className="text-right px-3 py-3 font-medium">Margem</th>
              <th className="text-right px-4 py-3 font-medium w-32">%</th>
            </tr></thead>
            <tbody>
              {clientes.map(l => (
                <tr key={l.workspace_id ?? l.cliente} className="border-b border-gray-50 last:border-0 hover:bg-orange-50/40 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {l.cliente}
                    {l.receita === 0 && l.custo_horas > 0 && (
                      <span className="ml-1.5 text-[10px] font-medium text-gray-500 bg-gray-100 rounded-full px-1.5 py-0.5">sem receita no período</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-gray-700">{l.receita ? brl(l.receita) : '—'}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-gray-400">{l.imposto ? brlCurto(l.imposto) : '—'}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-gray-500">{l.horas ? `${l.horas.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}h` : '—'}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-gray-600">{l.custo_horas ? brl(l.custo_horas) : '—'}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-gray-400">{l.custo_direto ? brlCurto(l.custo_direto) : '—'}</td>
                  <td className={cn('px-3 py-3 text-right tabular-nums font-medium', l.margem < 0 ? 'text-red-600' : 'text-gray-900')}>{brl(l.margem)}</td>
                  <td className="px-4 py-3">
                    {l.margem_pct == null ? <span className="text-gray-300 text-right block">—</span> : (
                      <div className="flex items-center justify-end gap-2">
                        {/* Barra: 0 → 50%, com o alvo marcado. Serve para ler a
                            coluna inteira de relance, não para precisão. */}
                        <div className="relative h-1.5 w-16 rounded-full bg-gray-100 overflow-hidden shrink-0">
                          <div className={cn('absolute inset-y-0 left-0 rounded-full',
                            l.margem_pct >= alvo ? 'bg-emerald-500' : l.margem_pct >= alvo / 2 ? 'bg-amber-500' : 'bg-red-500')}
                            style={{ width: `${Math.max(2, Math.min(100, (Math.max(0, l.margem_pct) / 50) * 100))}%` }} />
                          <div className="absolute inset-y-0 w-px bg-gray-400/60" style={{ left: `${(alvo / 50) * 100}%` }} />
                        </div>
                        <span className={cn('tabular-nums font-semibold w-14 text-right', corPct(l.margem_pct))}>
                          {l.margem_pct.toFixed(1)}%
                        </span>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50/60 font-semibold text-gray-900">
                <td className="px-4 py-3">Total de clientes</td>
                <td className="px-3 py-3 text-right tabular-nums">{brl(total.receita)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-gray-600">{brlCurto(total.imposto)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-gray-600">{total.horas.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}h</td>
                <td className="px-3 py-3 text-right tabular-nums text-gray-600">{brl(total.custo_horas)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-gray-600">{brlCurto(total.custo_direto)}</td>
                <td className={cn('px-3 py-3 text-right tabular-nums', total.margem < 0 ? 'text-red-600' : '')}>{brl(total.margem)}</td>
                <td className={cn('px-4 py-3 text-right tabular-nums', corPct(margemTotalPct))}>
                  {margemTotalPct != null ? `${margemTotalPct.toFixed(1)}%` : '—'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* A casa, à parte */}
        {!!casa.length && casa.some(l => l.custo_horas > 0 || l.receita > 0) && (
          <div className="mt-3 rounded-2xl border border-gray-200 bg-gray-50/60 px-4 py-3 text-sm text-gray-600">
            <b className="text-gray-800">A própria agência</b> — fora da conta de clientes:{' '}
            {casa.map(l => `${l.horas.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}h (${brl(l.custo_horas)}) de trabalho interno${l.receita > 0 ? `, ${brl(l.receita)} de receita própria` : ''}`).join(' · ')}.
          </div>
        )}

        {!!semReceita.length && (
          <p className="text-[11px] text-gray-500 mt-3">
            <b>{semReceita.length} cliente(s) com horas e sem recebimento no período</b> ({semReceita.map(l => l.cliente).join(', ')}) —
            em regime de caixa isso é normal quando o pagamento cai fora da janela; se persistir em 6 ou 12 meses, é trabalho não faturado.
          </p>
        )}

        <p className="text-[11px] text-gray-400 mt-2 flex items-start gap-1.5">
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          <span>
            Regime de caixa: receita = recebido no período; custo do tempo = horas medidas nas tarefas do
            cliente × custo/hora cheio (salário + encargos + provisões + estrutura + provisão de lucro já
            rateadas — RH → Horas). Produção = saídas pagas do cliente, sem estrutura, folha e impostos
            (que já estão contados no custo/hora e na coluna de imposto). Margem = receita − imposto −
            custo do tempo − produção.
          </span>
        </p>
      </>)}
    </div>
  )
}
