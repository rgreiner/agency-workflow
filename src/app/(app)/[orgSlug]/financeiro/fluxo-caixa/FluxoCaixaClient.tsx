'use client'

import { useMemo, useState, useEffect } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Upload, BarChart3 } from 'lucide-react'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend,
  CartesianGrid, ReferenceLine,
} from 'recharts'
import { formatBRL } from '@/lib/midia'
import { Select, MultiSelect } from '@/components/ui/Select'
import {
  fluxoDiario, fluxoMensal, contasDistintas, anosDisponiveis, type FluxoRow,
} from '@/lib/fluxo-caixa'
import type { CatCompRow } from '@/lib/fin-categorias-comp'
import type { CategoriaGrupoLike } from '@/lib/finance-categorias'
import { CategoriasCompetencia } from './CategoriasCompetencia'

const MESES_NOME = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const MESES_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const compactBRL = (v: number) => {
  const a = Math.abs(v)
  if (a >= 1000) return `${v < 0 ? '-' : ''}${(a / 1000).toFixed(0)}k`
  return String(Math.round(v))
}

const C = { receb: '#22c55e', pag: '#ef4444', recebL: '#a7f3d0', pagL: '#fecaca', atraso: '#f59e0b', saldoR: '#1e3a5f', saldoP: '#94a3b8' }

type Modo = 'diario' | 'mensal' | 'categorias'
const MODOS: { value: Modo; label: string }[] = [
  { value: 'diario', label: 'Diário' },
  { value: 'mensal', label: 'Mensal' },
  { value: 'categorias', label: 'Categorias' },
]
const TITULO: Record<Modo, string> = {
  diario: 'Fluxo de caixa diário',
  mensal: 'Fluxo de caixa mensal',
  categorias: 'Receitas e despesas por categoria',
}

export function FluxoCaixaClient({ orgSlug, rows, catRows, categorias }: {
  orgSlug: string
  rows: FluxoRow[]
  catRows: CatCompRow[]
  categorias: CategoriaGrupoLike[]
}) {
  const [modo, setModo] = useState<Modo>('diario')

  // Contas selecionadas por modo (vazio = todas). Persistido por org no localStorage —
  // assim dá pra deixar os ativos de baixa liquidez fora do Diário e incluir no Mensal.
  const SEL_KEY = `fluxo-caixa-contas:${orgSlug}`
  const [contaSel, setContaSel] = useState<{ diario: string[]; mensal: string[] }>({ diario: [], mensal: [] })
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SEL_KEY)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setContaSel(JSON.parse(raw))
    } catch {}
  }, [SEL_KEY])
  function setContasDoModo(vals: string[]) {
    setContaSel(prev => {
      const next = { ...prev, [modo === 'categorias' ? 'mensal' : modo]: vals }
      try { localStorage.setItem(SEL_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }
  // A aba Categorias não filtra por conta (competência não é caixa: o mesmo
  // custo pode ser pago por qualquer conta, e a agregação nem carrega a conta).
  const contasModo = modo === 'categorias' ? [] : contaSel[modo]

  const contas = useMemo(() => contasDistintas(rows), [rows])
  const anos = useMemo(() => anosDisponiveis(rows), [rows])

  // Abre sempre no mês/ano atual (não no último lançamento — há recorrências até 2032).
  const now = new Date()
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const [ano, setAno] = useState(now.getFullYear())

  const contaOpts = contas.map(c => ({ value: c, label: c }))
  const anoOpts = [...new Set([...anos, now.getFullYear()])]
    .sort((a, b) => a - b)
    .map(a => ({ value: String(a), label: String(a) }))

  // Corte do "hoje" para marcar previsto vencido (projetado que não aconteceu).
  const hojeYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const dadosDia = useMemo(() => fluxoDiario(rows, ym, contaSel.diario, hojeYmd), [rows, ym, contaSel.diario, hojeYmd])
  const dadosMes = useMemo(() => fluxoMensal(rows, ano, contaSel.mensal, { ano: now.getFullYear(), mes: now.getMonth() }), [rows, ano, contaSel.mensal, hojeYmd]) // eslint-disable-line react-hooks/exhaustive-deps

  // Marcador do dia/mês atual no gráfico (só quando o período visível é o corrente).
  const ymAtual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const hojeDiaMarker = ym === ymAtual ? String(now.getDate()).padStart(2, '0') : null
  const hojeMesMarker = ano === now.getFullYear() ? MESES_ABBR[now.getMonth()] : null

  function shiftMes(delta: number) {
    const [y, m] = ym.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setYm(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const [ymY, ymM] = ym.split('-').map(Number)

  if (rows.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold text-gray-900 mb-1">Fluxo de caixa</h1>
        <div className="mt-8 text-center py-20 bg-white rounded-xl border border-gray-200">
          <BarChart3 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-gray-900 font-medium">Nenhum dado ainda</h3>
          <p className="text-gray-500 text-sm mt-1 mb-4">Importe o extrato da Conta Azul para ver o fluxo de caixa.</p>
          <Link href={`/${orgSlug}/financeiro/importar`}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 transition">
            <Upload className="w-4 h-4" /> Importar extrato
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-lg font-semibold text-gray-900">{TITULO[modo]}</h1>
        {/* toggle Diário / Mensal / Categorias */}
        <div className="inline-flex bg-gray-100 rounded-xl p-0.5">
          {MODOS.map(m => (
            <button key={m.value} onClick={() => setModo(m.value)} aria-pressed={modo === m.value}
              className={`px-4 py-1.5 text-sm font-medium rounded-[10px] transition-colors ${modo === m.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {modo === 'categorias' ? (
        <CategoriasCompetencia orgSlug={orgSlug} rows={catRows} categorias={categorias} />
      ) : (
        <>
        {/* controles */}
        <div className="flex items-center gap-3 flex-wrap">
          {modo === 'diario' ? (
            <div className="inline-flex items-center gap-1 bg-white border border-gray-200 rounded-xl px-1 py-1">
              <button onClick={() => shiftMes(-1)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition" aria-label="Mês anterior"><ChevronLeft className="w-4 h-4" /></button>
              <span className="text-sm font-medium text-gray-800 min-w-[140px] text-center">{MESES_NOME[ymM - 1]} de {ymY}</span>
              <button onClick={() => shiftMes(1)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition" aria-label="Próximo mês"><ChevronRight className="w-4 h-4" /></button>
            </div>
          ) : (
            <div className="w-32"><Select value={String(ano)} onChange={v => setAno(Number(v))} options={anoOpts} /></div>
          )}
          <div className="w-64">
            <MultiSelect values={contasModo} onChange={setContasDoModo} options={contaOpts} allLabel="Todas as contas" />
          </div>
        </div>

        {/* gráfico */}
        <section className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              {modo === 'diario' ? (
                <ComposedChart data={dadosDia} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="dia" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} interval="preserveStartEnd" minTickGap={14} />
                  <YAxis tickFormatter={compactBRL} tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={44} />
                  <Tooltip content={<FluxoTooltip modo="diario" />} />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                  <ReferenceLine y={0} stroke="#cbd5e1" />
                  {hojeDiaMarker && (
                    <ReferenceLine x={hojeDiaMarker} stroke="#f59e0b" strokeDasharray="3 3"
                      label={{ value: 'Hoje', position: 'top', fontSize: 10, fill: '#f59e0b' }} />
                  )}
                  {/* realizado (sólido) na base, previsto (claro) e atrasado (âmbar) empilhados por cima */}
                  <Bar dataKey="recebimentos" name="Recebimentos" stackId="rec" fill={C.receb} radius={[3, 3, 0, 0]} maxBarSize={20} />
                  <Bar dataKey="recebPrevisto" name="A receber" stackId="rec" fill={C.recebL} radius={[3, 3, 0, 0]} maxBarSize={20} />
                  <Bar dataKey="recebAtrasado" name="Atrasado" stackId="rec" fill={C.atraso} radius={[3, 3, 0, 0]} maxBarSize={20} />
                  <Bar dataKey="pagamentos" name="Pagamentos" stackId="pag" fill={C.pag} radius={[0, 0, 3, 3]} maxBarSize={20} />
                  <Bar dataKey="pagPrevisto" name="A pagar" stackId="pag" fill={C.pagL} radius={[0, 0, 3, 3]} maxBarSize={20} />
                  <Bar dataKey="pagAtrasado" name="Atrasado" stackId="pag" fill={C.atraso} legendType="none" radius={[0, 0, 3, 3]} maxBarSize={20} />
                  <Line dataKey="saldoProjetado" name="Saldo projetado" type="monotone" stroke={C.saldoP} strokeWidth={2} strokeDasharray="4 3" dot={false} />
                  <Line dataKey="saldo" name="Saldo" type="monotone" stroke={C.saldoR} strokeWidth={2} dot={{ r: 2 }} />
                </ComposedChart>
              ) : (
                <ComposedChart data={dadosMes} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} interval="preserveStartEnd" minTickGap={8} />
                  <YAxis tickFormatter={compactBRL} tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={44} />
                  <Tooltip content={<FluxoTooltip modo="mensal" />} />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                  <ReferenceLine y={0} stroke="#cbd5e1" />
                  {hojeMesMarker && (
                    <ReferenceLine x={hojeMesMarker} stroke="#f59e0b" strokeDasharray="3 3"
                      label={{ value: 'Hoje', position: 'top', fontSize: 10, fill: '#f59e0b' }} />
                  )}
                  {/* realizado na base, previsto e atrasado empilhados por cima (coluna única por mês) */}
                  <Bar dataKey="recRealizado" name="Receb. realizado" stackId="rec" fill={C.receb} radius={[3, 3, 0, 0]} maxBarSize={26} />
                  <Bar dataKey="recPrevisto" name="Receb. previsto" stackId="rec" fill={C.recebL} radius={[3, 3, 0, 0]} maxBarSize={26} />
                  <Bar dataKey="recAtrasado" name="Atrasado" stackId="rec" fill={C.atraso} radius={[3, 3, 0, 0]} maxBarSize={26} />
                  <Bar dataKey="pagRealizado" name="Pagto realizado" stackId="pag" fill={C.pag} radius={[0, 0, 3, 3]} maxBarSize={26} />
                  <Bar dataKey="pagPrevisto" name="Pagto previsto" stackId="pag" fill={C.pagL} radius={[0, 0, 3, 3]} maxBarSize={26} />
                  <Bar dataKey="pagAtrasado" name="Atrasado" stackId="pag" fill={C.atraso} legendType="none" radius={[0, 0, 3, 3]} maxBarSize={26} />
                  <Line dataKey="saldoPrevisto" name="Saldo previsto" type="monotone" stroke={C.saldoP} strokeWidth={2} strokeDasharray="4 3" dot={false} />
                  <Line dataKey="saldoRealizado" name="Saldo realizado" type="monotone" stroke={C.saldoR} strokeWidth={2} dot={{ r: 2 }} />
                </ComposedChart>
              )}
            </ResponsiveContainer>
          </div>
        </section>

        {/* tabela */}
        {modo === 'diario' ? <TabelaDiaria dados={dadosDia} /> : <TabelaMensal dados={dadosMes} />}
        </>
      )}
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FluxoTooltip({ active, payload, label, modo }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-900 mb-1">{modo === 'diario' ? `Dia ${label}` : label}</p>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {payload.filter((p: any) => p.value !== 0 && p.value != null).map((p: any) => (
        <p key={p.dataKey} className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />{p.name}</span>
          <span className="font-medium text-gray-700">{formatBRL(Math.abs(p.value))}</span>
        </p>
      ))}
    </div>
  )
}

function TabelaDiaria({ dados }: { dados: ReturnType<typeof fluxoDiario> }) {
  const linhas = dados.filter(d => d.recebimentos !== 0 || d.pagamentos !== 0 || d.recebPrevisto !== 0 || d.pagPrevisto !== 0 || d.recebAtrasado !== 0 || d.pagAtrasado !== 0)
  if (linhas.length === 0) return <p className="text-sm text-gray-400">Sem movimento neste mês.</p>
  const temPrevisto = dados.some(d => d.recebPrevisto !== 0 || d.pagPrevisto !== 0 || d.recebAtrasado !== 0 || d.pagAtrasado !== 0)
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/50 text-xs text-gray-400">
            <th className="text-left px-4 py-2.5 font-medium">Dia</th>
            <th className="text-right px-4 py-2.5 font-medium">Recebimentos</th>
            <th className="text-right px-4 py-2.5 font-medium">Pagamentos</th>
            {temPrevisto && <th className="text-right px-4 py-2.5 font-medium">A receber</th>}
            {temPrevisto && <th className="text-right px-4 py-2.5 font-medium">A pagar</th>}
            <th className="text-right px-4 py-2.5 font-medium">{temPrevisto ? 'Saldo projetado' : 'Saldo'}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {linhas.map(d => (
            <tr key={d.dia} className="hover:bg-gray-50/50">
              <td className="px-4 py-2 text-gray-600">{d.dia}</td>
              <td className="px-4 py-2 text-right text-emerald-600">{d.recebimentos ? formatBRL(d.recebimentos) : '—'}</td>
              <td className="px-4 py-2 text-right text-red-600">{d.pagamentos ? formatBRL(Math.abs(d.pagamentos)) : '—'}</td>
              {temPrevisto && <td className={`px-4 py-2 text-right ${d.recebAtrasado ? 'text-amber-600' : 'text-emerald-500/70'}`}>{d.recebPrevisto + d.recebAtrasado ? formatBRL(d.recebPrevisto + d.recebAtrasado) : '—'}</td>}
              {temPrevisto && <td className={`px-4 py-2 text-right ${d.pagAtrasado ? 'text-amber-600' : 'text-red-500/70'}`}>{d.pagPrevisto + d.pagAtrasado ? formatBRL(Math.abs(d.pagPrevisto + d.pagAtrasado)) : '—'}</td>}
              <td className={`px-4 py-2 text-right font-medium ${d.saldoProjetado >= 0 ? 'text-gray-900' : 'text-red-600'}`}>{formatBRL(d.saldoProjetado)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TabelaMensal({ dados }: { dados: ReturnType<typeof fluxoMensal> }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/50 text-xs text-gray-400">
            <th className="text-left px-4 py-2.5 font-medium">Mês</th>
            <th className="text-right px-4 py-2.5 font-medium">Receb. realizado</th>
            <th className="text-right px-4 py-2.5 font-medium">Receb. previsto</th>
            <th className="text-right px-4 py-2.5 font-medium">Pagto realizado</th>
            <th className="text-right px-4 py-2.5 font-medium">Pagto previsto</th>
            <th className="text-right px-4 py-2.5 font-medium">Saldo realizado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {dados.map(m => (
            <tr key={m.mes} className="hover:bg-gray-50/50">
              <td className="px-4 py-2 text-gray-600 capitalize">{m.mes}</td>
              <td className="px-4 py-2 text-right text-emerald-600">{m.recRealizado ? formatBRL(m.recRealizado) : '—'}</td>
              <td className={`px-4 py-2 text-right ${m.recAtrasado ? 'text-amber-600' : 'text-emerald-500/70'}`}>{m.recPrevisto + m.recAtrasado ? formatBRL(m.recPrevisto + m.recAtrasado) : '—'}</td>
              <td className="px-4 py-2 text-right text-red-600">{m.pagRealizado ? formatBRL(Math.abs(m.pagRealizado)) : '—'}</td>
              <td className={`px-4 py-2 text-right ${m.pagAtrasado ? 'text-amber-600' : 'text-red-500/70'}`}>{m.pagPrevisto + m.pagAtrasado ? formatBRL(Math.abs(m.pagPrevisto + m.pagAtrasado)) : '—'}</td>
              <td className={`px-4 py-2 text-right font-medium ${m.saldoRealizado >= 0 ? 'text-gray-900' : 'text-red-600'}`}>{formatBRL(m.saldoRealizado)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
