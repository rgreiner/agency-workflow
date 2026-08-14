'use client'

import { useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts'
import { formatBRL } from '@/lib/midia'
import { Select } from '@/components/ui/Select'
import type { CategoriaGrupoLike } from '@/lib/finance-categorias'
import {
  serieCategorias, coresDeFatias, anosDisponiveis, MESES_ABBR,
  type CatCompRow, type Foco, type Visao, type SerieCategorias,
} from '@/lib/fin-categorias-comp'

const FOCOS: { value: Foco; label: string }[] = [
  { value: 'tudo', label: 'Tudo' },
  { value: 'realizado', label: 'Realizado' },
  { value: 'previsto', label: 'A realizar' },
]

const compactBRL = (v: number) => {
  const a = Math.abs(v)
  if (a >= 1000) return `${v < 0 ? '-' : ''}${(a / 1000).toFixed(0)}k`
  return String(Math.round(v))
}
const pct = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)}%`

/**
 * Receita e despesa por categoria, dentro do mês de COMPETÊNCIA — dois gráficos
 * de barras empilhadas (um por natureza), com total e percentual de cada
 * categoria. Realizado e a realizar entram juntos por padrão: em competência o
 * mês corrente é sempre parte um, parte outro.
 */
export function CategoriasCompetencia({ rows, categorias }: {
  rows: CatCompRow[]
  categorias: CategoriaGrupoLike[]
}) {
  const anos = useMemo(() => anosDisponiveis(rows), [rows])
  const anoAtual = new Date().getFullYear()
  const [ano, setAno] = useState(anoAtual)
  const [visao, setVisao] = useState<Visao>('macro')
  const [foco, setFoco] = useState<Foco>('tudo')
  // Mês em foco (0–11): recorta os totais/percentuais; o gráfico segue no ano.
  const [mesFoco, setMesFoco] = useState<number | null>(null)

  const anoOpts = [...new Set([...anos, anoAtual])].sort((a, b) => b - a).map(a => ({ value: String(a), label: String(a) }))

  const receita = useMemo(
    () => serieCategorias(rows, { ano, tipo: 'receita', visao, foco, categorias, mesFoco }),
    [rows, ano, visao, foco, categorias, mesFoco])
  const despesa = useMemo(
    () => serieCategorias(rows, { ano, tipo: 'despesa', visao, foco, categorias, mesFoco }),
    [rows, ano, visao, foco, categorias, mesFoco])

  const mesCorrente = ano === anoAtual ? new Date().getMonth() : null

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-28"><Select value={String(ano)} onChange={v => { setAno(Number(v)); setMesFoco(null) }} options={anoOpts} /></div>

        <div className="inline-flex bg-gray-100 rounded-xl p-0.5">
          {FOCOS.map(f => (
            <button key={f.value} onClick={() => setFoco(f.value)} aria-pressed={foco === f.value}
              className={`px-3 py-1.5 text-sm font-medium rounded-[10px] transition-colors ${foco === f.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {f.label}
            </button>
          ))}
        </div>

        <div className="inline-flex bg-gray-100 rounded-xl p-0.5">
          {([['macro', 'Macro'], ['detalhe', 'Detalhada']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setVisao(v)} aria-pressed={visao === v}
              className={`px-3 py-1.5 text-sm font-medium rounded-[10px] transition-colors ${visao === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>

        {mesFoco != null && (
          <button onClick={() => setMesFoco(null)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-orange-50 text-orange-700 hover:bg-orange-100 transition-colors">
            {MESES_ABBR[mesFoco]}/{String(ano).slice(2)} · limpar mês
          </button>
        )}
      </div>

      <GraficoCategoria titulo="Receitas por categoria" serie={receita} categorias={categorias}
        ano={ano} mesFoco={mesFoco} onMes={setMesFoco} mesCorrente={mesCorrente} tom="emerald" />
      <GraficoCategoria titulo="Despesas por categoria" serie={despesa} categorias={categorias}
        ano={ano} mesFoco={mesFoco} onMes={setMesFoco} mesCorrente={mesCorrente} tom="red" />

      <p className="text-[11px] text-gray-400">
        Por competência (o mês a que o valor se refere), não pela data em que o dinheiro andou.
        Transferência entre contas fica de fora. Clique numa barra para ver só aquele mês.
      </p>
    </div>
  )
}

function GraficoCategoria({ titulo, serie, categorias, ano, mesFoco, onMes, mesCorrente, tom }: {
  titulo: string
  serie: SerieCategorias
  categorias: CategoriaGrupoLike[]
  ano: number
  mesFoco: number | null
  onMes: (mi: number | null) => void
  mesCorrente: number | null
  tom: 'emerald' | 'red'
}) {
  const cores = useMemo(() => coresDeFatias(serie.categorias, categorias), [serie.categorias, categorias])
  const nomePorKey = useMemo(() => new Map(serie.categorias.map(f => [f.key, f.nome])), [serie.categorias])
  const visiveis = serie.categorias.filter(f => f.total > 0.005)
  const rotulo = mesFoco != null ? `${MESES_ABBR[mesFoco]}/${String(ano).slice(2)}` : String(ano)
  const accent = tom === 'emerald' ? 'text-emerald-600' : 'text-red-600'

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{titulo}</h2>
          <p className="text-[11px] text-gray-400">{rotulo} · {visiveis.length} categoria{visiveis.length === 1 ? '' : 's'}</p>
        </div>
        <div className="text-right">
          <p className={`text-lg font-semibold ${accent}`}>{formatBRL(serie.total)}</p>
          <p className="text-[11px] text-gray-400">
            realizado {formatBRL(serie.totalRealizado)} · a realizar {formatBRL(serie.totalPrevisto)}
          </p>
        </div>
      </div>

      {serie.total === 0 && serie.pontos.every(p => p.total === 0) ? (
        <p className="text-sm text-gray-400 py-10 text-center">Sem movimento nesta natureza em {ano}.</p>
      ) : (
        <div className="grid lg:grid-cols-[1fr_300px] gap-5">
          <div className="h-72 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={serie.pontos} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
                onClick={next => {
                  // recharts tipa activeTooltipIndex como number | string | null
                  const i = Number(next?.activeTooltipIndex)
                  if (Number.isInteger(i)) onMes(mesFoco === i ? null : i)
                }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                <YAxis tickFormatter={compactBRL} tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={44} />
                <Tooltip cursor={{ fill: '#f8fafc' }} content={<CatTooltip nomePorKey={nomePorKey} />} />
                <ReferenceLine y={0} stroke="#cbd5e1" />
                {mesCorrente != null && (
                  <ReferenceLine x={MESES_ABBR[mesCorrente]} stroke="#f59e0b" strokeDasharray="3 3"
                    label={{ value: 'Hoje', position: 'top', fontSize: 10, fill: '#f59e0b' }} />
                )}
                {serie.categorias.map((f, i) => (
                  <Bar key={f.key} dataKey={f.key} name={f.nome} stackId="cat"
                    fill={cores.get(f.key)} maxBarSize={34}
                    radius={i === serie.categorias.length - 1 ? [3, 3, 0, 0] : undefined}>
                    {/* mês fora do foco fica apagado — a leitura vai para o mês escolhido */}
                    {serie.pontos.map(p => (
                      <Cell key={p.mi} cursor="pointer" fillOpacity={mesFoco == null || mesFoco === p.mi ? 1 : 0.3} />
                    ))}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <ul className="space-y-2 min-w-0 self-start">
            {visiveis.length === 0 && <li className="text-sm text-gray-400">Sem movimento em {rotulo}.</li>}
            {visiveis.map(f => (
              <li key={f.key} className="min-w-0">
                <div className="flex items-baseline justify-between gap-2 mb-0.5">
                  <span className="text-xs text-gray-600 truncate inline-flex items-center gap-1.5" title={f.nome}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cores.get(f.key) }} />
                    {f.nome}
                  </span>
                  <span className="text-[11px] text-gray-500 tabular-nums shrink-0">
                    {formatBRL(f.total)} <span className="text-gray-300">·</span> {pct(f.pct)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(f.pct, 2)}%`, backgroundColor: cores.get(f.key) }} />
                </div>
                {f.previsto > 0.005 && f.realizado > 0.005 && (
                  <p className="text-[10px] text-gray-400 mt-0.5 tabular-nums">
                    realizado {formatBRL(f.realizado)} · a realizar {formatBRL(f.previsto)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {visiveis.length > 0 && <TabelaMesCategoria serie={serie} cores={cores} mesFoco={mesFoco} onMes={onMes} />}
    </section>
  )
}

/** Categoria × mês do ano: o mesmo dado do gráfico, para conferir número a número. */
function TabelaMesCategoria({ serie, cores, mesFoco, onMes }: {
  serie: SerieCategorias
  cores: Map<string, string>
  mesFoco: number | null
  onMes: (mi: number | null) => void
}) {
  const totalAno = serie.categorias.reduce((s, f) => s + f.porMes.reduce((a, b) => a + b, 0), 0)
  return (
    <div className="mt-5 -mx-5 -mb-5 border-t border-gray-100 overflow-x-auto">
      <table className="w-full min-w-[760px] text-xs">
        <thead>
          <tr className="text-gray-400 bg-gray-50/50">
            <th className="text-left px-5 py-2 font-medium sticky left-0 bg-gray-50/50">Categoria</th>
            {MESES_ABBR.map((m, i) => (
              <th key={m} className={`text-right px-2 py-2 font-medium capitalize cursor-pointer hover:text-gray-700 ${mesFoco === i ? 'text-orange-600' : ''}`}
                onClick={() => onMes(mesFoco === i ? null : i)}>{m}</th>
            ))}
            <th className="text-right px-5 py-2 font-medium">Ano</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {serie.categorias.map(f => {
            const soma = f.porMes.reduce((a, b) => a + b, 0)
            return (
              <tr key={f.key} className="hover:bg-gray-50/50">
                <td className="px-5 py-1.5 text-gray-600 truncate max-w-[200px] sticky left-0 bg-white" title={f.nome}>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cores.get(f.key) }} />
                    {f.nome}
                  </span>
                </td>
                {f.porMes.map((v, i) => (
                  <td key={i} className={`px-2 py-1.5 text-right tabular-nums ${v > 0.005 ? 'text-gray-700' : 'text-gray-300'} ${mesFoco === i ? 'bg-orange-50/60' : ''}`}>
                    {v > 0.005 ? compactBRL(v) : '—'}
                  </td>
                ))}
                <td className="px-5 py-1.5 text-right tabular-nums font-medium text-gray-900">{formatBRL(soma)}</td>
              </tr>
            )
          })}
          <tr className="bg-gray-50/50 font-medium">
            <td className="px-5 py-2 text-gray-500 sticky left-0 bg-gray-50/50">Total</td>
            {MESES_ABBR.map((_, i) => {
              const v = serie.categorias.reduce((s, f) => s + f.porMes[i], 0)
              return <td key={i} className={`px-2 py-2 text-right tabular-nums ${v > 0.005 ? 'text-gray-700' : 'text-gray-300'} ${mesFoco === i ? 'bg-orange-50/60' : ''}`}>{v > 0.005 ? compactBRL(v) : '—'}</td>
            })}
            <td className="px-5 py-2 text-right tabular-nums text-gray-900">{formatBRL(totalAno)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

interface TooltipPayload { dataKey?: string | number; name?: string; value?: number; color?: string }
function CatTooltip({ active, payload, label, nomePorKey }: {
  active?: boolean
  payload?: TooltipPayload[]
  label?: string
  nomePorKey: Map<string, string>
}) {
  if (!active || !payload?.length) return null
  const itens = payload.filter(p => (p.value ?? 0) > 0.005).slice().reverse()
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0)
  if (total <= 0.005) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs max-w-[260px]">
      <p className="font-semibold text-gray-900 mb-1 capitalize">{label} <span className="text-gray-400 font-normal">· {formatBRL(total)}</span></p>
      {itens.map(p => (
        <p key={String(p.dataKey)} className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 truncate">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
            <span className="truncate">{nomePorKey.get(String(p.dataKey)) ?? p.name}</span>
          </span>
          <span className="font-medium text-gray-700 tabular-nums shrink-0">
            {formatBRL(p.value ?? 0)} <span className="text-gray-300">·</span> {pct(((p.value ?? 0) / total) * 100)}
          </span>
        </p>
      ))}
    </div>
  )
}
