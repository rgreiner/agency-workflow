'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { Plus, RotateCcw, Trash2, TrendingDown } from 'lucide-react'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Cell,
} from 'recharts'
import { formatBRL } from '@/lib/midia'
import { Select } from '@/components/ui/Select'
import { Switch } from '@/components/ui/Switch'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { macroPorCategoria, type CategoriaGrupoLike } from '@/lib/finance-categorias'
import { rotuloMes, addMes, type CuboRow } from '@/lib/fin-cubo'
import {
  projetar, CENARIO_VAZIO, MESES_HISTORICO,
  type AjusteCategoria, type Cenario, type Celula, type LinhaCategoria, type ModoCategoria, type Tipo,
} from '@/lib/fin-planejamento'

/** Cenário e horizonte por usuário. Versionar a chave quando o formato mudar. */
const PREF_KEY = 'flow.planejamento.v1'
const C = { receita: '#22c55e', receitaL: '#a7f3d0', despesa: '#ef4444', despesaL: '#fecaca', saldo: '#78716c' }

const MODOS: { value: ModoCategoria; label: string }[] = [
  { value: 'auto', label: 'Automático (lançado + estimativa)' },
  { value: 'lancado', label: 'Só o que está lançado' },
  { value: 'valor', label: 'Valor fixo por mês' },
  { value: 'zero', label: 'Zerar (cortado)' },
]
const HORIZONTES = [{ value: '6', label: 'Próximos 6 meses' }, { value: '12', label: 'Próximos 12 meses' }]

const compacto = (v: number) => {
  const a = Math.abs(v)
  return a >= 1000 ? `${v < 0 ? '-' : ''}${(a / 1000).toFixed(a >= 10000 ? 0 : 1).replace('.', ',')}k` : String(Math.round(v))
}
const parseValor = (s: string) => Number(s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0
const mesAtual = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

export function PlanejamentoClient({ rows, categorias, saldoInicial, contasLiquidas, imoveis }: {
  rows: CuboRow[]
  categorias: CategoriaGrupoLike[]
  saldoInicial: number
  contasLiquidas: string[]
  imoveis: number
}) {
  const [hoje, setHoje] = useState<string | null>(null)
  const [horizonte, setHorizonte] = useState(6)
  const [cenario, setCenario] = useState<Cenario>(CENARIO_VAZIO)
  const [editando, setEditando] = useState<LinhaCategoria | null>(null)

  // Relógio e localStorage só no efeito: no primeiro render servidor e cliente divergiriam.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setHoje(mesAtual())
    try {
      const cru = localStorage.getItem(PREF_KEY)
      if (cru) {
        const p = JSON.parse(cru) as { horizonte?: number; cenario?: Partial<Cenario> }
        if (p.horizonte === 6 || p.horizonte === 12) setHorizonte(p.horizonte)
        if (p.cenario) setCenario({ ...CENARIO_VAZIO, ...p.cenario })
      }
    } catch { /* preferência corrompida não pode derrubar a tela */ }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [])
  useEffect(() => {
    if (!hoje) return
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ horizonte, cenario })) } catch { /* modo privado */ }
  }, [hoje, horizonte, cenario])

  const macros = useMemo(() => ({
    receita: macroPorCategoria(categorias, 'entrada'),
    despesa: macroPorCategoria(categorias, 'saida'),
  }), [categorias])

  const p = useMemo(() => hoje ? projetar(rows, {
    hoje, horizonte, saldoInicial, cenario,
    macroDe: (tipo, cat) => macros[tipo].get(cat.toLowerCase()) ?? 'Outros',
  }) : null, [rows, hoje, horizonte, saldoInicial, cenario, macros])

  const setAjusteCategoria = (key: string, a: AjusteCategoria | null) => setCenario(c => {
    const categorias = { ...c.categorias }
    if (!a || a.modo === 'auto') delete categorias[key]; else categorias[key] = a
    return { ...c, categorias }
  })

  if (!p || !hoje) return <div className="p-6 text-sm text-gray-500">Carregando…</div>

  const iAtual = p.passados.length
  const fimHorizonte = p.futuros[p.futuros.length - 1]
  const saldoFinal = p.saldo[p.saldo.length - 1] ?? saldoInicial
  const premissasAtivas = Object.keys(cenario.categorias).length + Object.keys(cenario.inadimplentes).length
    + Object.keys(cenario.contratos).length + cenario.extras.length
  const opMeses = p.futuros.map(m => ({ value: m, label: rotuloMes(m) }))

  const dados = p.colunas.map((m, i) => ({
    mes: rotuloMes(m) + (i === iAtual ? '*' : ''),
    receita: Math.round(p.receitas[i].total),
    despesa: Math.round(p.despesas[i].total),
    saldo: p.saldo[i] == null ? undefined : Math.round(p.saldo[i]!),
    projetado: i >= iAtual,
  }))

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Planejamento</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Real × projeção por categoria e o saldo mês a mês. Simular aqui não altera lançamento.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {premissasAtivas > 0 && (
            <button onClick={() => setCenario(CENARIO_VAZIO)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 hover:text-gray-800 transition-colors">
              <RotateCcw className="w-3.5 h-3.5" /> Limpar premissas ({premissasAtivas})
            </button>
          )}
          <div className="w-48"><Select value={String(horizonte)} onChange={v => setHorizonte(Number(v))} options={HORIZONTES} /></div>
        </div>
      </div>

      {/* ── Números de cabeça ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi label="Caixa hoje" valor={formatBRL(saldoInicial)}
          dica={`Contas líquidas: ${contasLiquidas.join(', ') || '—'}${imoveis > 0 ? ` · imóveis (${formatBRL(imoveis)}) fora` : ''}`} />
        <Kpi label={`Saldo em ${rotuloMes(fimHorizonte)}`} valor={formatBRL(saldoFinal)} alerta={saldoFinal < 0} />
        <Kpi label="Menor saldo" valor={p.menorSaldo ? formatBRL(p.menorSaldo.valor) : '—'}
          dica={p.menorSaldo ? `em ${rotuloMes(p.menorSaldo.mes)}` : undefined} alerta={(p.menorSaldo?.valor ?? 0) < 0} />
        <Kpi label="Caixa fica negativo" valor={p.primeiroNegativo ? rotuloMes(p.primeiroNegativo) : 'Não, no horizonte'}
          alerta={!!p.primeiroNegativo} />
        <Kpi label="Projeção já lançada"
          valor={`${Math.round(p.confiabilidade.receita * 100)}% · ${Math.round(p.confiabilidade.despesa * 100)}%`}
          dica="receitas · despesas — o resto é estimativa ou premissa" />
      </div>

      {/* ── Gráfico ─────────────────────────────────────────────────────── */}
      <section className="bg-white border border-gray-200 rounded-2xl p-4">
        <div className="flex items-center gap-4 flex-wrap text-xs text-gray-500 mb-2">
          <Leg cor={C.receita} label="Receitas" /><Leg cor={C.despesa} label="Despesas" />
          <Leg cor={C.saldo} label="Saldo no fim do mês" linha />
          <span className="ml-auto">Cor clara = projeção · * mês atual (só o que falta)</span>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={dados} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--color-gray-100, #f3f4f6)" />
              <XAxis dataKey="mes" tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={compacto} tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={48} />
              <ReferenceLine y={0} stroke="#d6d3d1" />
              <Tooltip formatter={(v, n) => [formatBRL(Number(v)), n === 'receita' ? 'Receitas' : n === 'despesa' ? 'Despesas' : 'Saldo']}
                contentStyle={{ borderRadius: 12, fontSize: 12 }} />
              <Bar dataKey="receita" radius={[4, 4, 0, 0]} maxBarSize={22}>
                {dados.map((d, i) => <Cell key={i} fill={d.projetado ? C.receitaL : C.receita} />)}
              </Bar>
              <Bar dataKey="despesa" radius={[4, 4, 0, 0]} maxBarSize={22}>
                {dados.map((d, i) => <Cell key={i} fill={d.projetado ? C.despesaL : C.despesa} />)}
              </Bar>
              <Line dataKey="saldo" type="monotone" stroke={C.saldo} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* ── O que a projeção está supondo ───────────────────────────────── */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Bloco titulo="Contratos que terminam no período" vazio="Nenhum contrato lançado termina dentro do horizonte."
          dica="A receita para no último mês lançado. Ligue para simular a renovação." n={p.contratos.length}>
          {p.contratos.map(c => {
            const aj = cenario.contratos[c.contato]
            return (
              <Linha key={c.contato} titulo={c.contato}
                sub={`${c.categoria} · ${formatBRL(c.mensal)}/mês · último lançado ${rotuloMes(c.ultimo)}`}>
                {aj && <ValorInput valor={aj.valor ?? c.mensal} onChange={v => setCenario(s => ({ ...s, contratos: { ...s.contratos, [c.contato]: { valor: v } } }))} />}
                <Switch size="sm" label={`Renovar ${c.contato}`} checked={!!aj} onChange={on => setCenario(s => {
                  const contratos = { ...s.contratos }
                  if (on) contratos[c.contato] = {}; else delete contratos[c.contato]
                  return { ...s, contratos }
                })} />
              </Linha>
            )
          })}
          {p.semLancamento.map(c => (
            <Linha key={`sl:${c.contato}`} titulo={c.contato} aviso
              sub={`${c.categoria} · pagou ~${formatBRL(c.mediana)}/mês até ${rotuloMes(c.ultimo)} e não tem nada lançado à frente — contrato acabou, mudou de nome ou falta lançar?`} />
          ))}
        </Bloco>

        <Bloco titulo="Inadimplentes" vazio="Nenhuma receita vencida em aberto."
          dica="Ficam fora da projeção. Ligue para simular o recebimento parcelado." n={p.inadimplentes.length}>
          {p.inadimplentes.map(i => {
            const aj = cenario.inadimplentes[i.contato]
            const set = (v: { parcelas: number; inicio: string } | null) => setCenario(s => {
              const inadimplentes = { ...s.inadimplentes }
              if (v) inadimplentes[i.contato] = v; else delete inadimplentes[i.contato]
              return { ...s, inadimplentes }
            })
            return (
              <Linha key={i.contato} titulo={`${i.contato} · ${formatBRL(i.total)}`}
                sub={`${i.categoria} · vencido desde ${rotuloMes(i.desde)}`}>
                {aj && (
                  <>
                    <div className="w-24"><Select size="sm" value={String(aj.parcelas)} onChange={v => set({ ...aj, parcelas: Number(v) })}
                      options={[1, 2, 3, 4, 5, 6, 8, 10, 12].map(n => ({ value: String(n), label: n === 1 ? 'à vista' : `${n}x` }))} /></div>
                    <div className="w-24"><Select size="sm" value={aj.inicio} onChange={v => set({ ...aj, inicio: v })} options={opMeses} /></div>
                  </>
                )}
                <Switch size="sm" label={`Contar recebimento de ${i.contato}`} checked={!!aj}
                  onChange={on => set(on ? { parcelas: 6, inicio: addMes(hoje, 2) } : null)} />
              </Linha>
            )
          })}
        </Bloco>

        <Bloco titulo="Estimativas e pontos de atenção" vazio="Tudo o que está projetado vem de lançamento."
          dica={`Régua: mediana dos ${MESES_HISTORICO} últimos meses fechados de cada categoria recorrente.`} n={p.alertas.length}>
          {p.alertas.map(a => (
            <Linha key={a.key} titulo={`${a.categoria} · ${a.tipo === 'receita' ? 'receita' : 'despesa'}`}
              aviso={a.motivo !== 'estimado'}
              sub={a.motivo === 'estimado'
                ? `+${formatBRL(a.valor)}/mês estimado — costuma ${a.tipo === 'receita' ? 'entrar' : 'sair'} ${formatBRL(a.mediana)}, lançado ${formatBRL(a.lancado)}`
                : a.motivo === 'novo'
                  ? `${formatBRL(a.valor)}/mês lançado sem histórico nos últimos ${MESES_HISTORICO} meses`
                  : `lançado ${formatBRL(a.lancado)}/mês, ${formatBRL(a.valor)} acima do que costuma sair (${formatBRL(a.mediana)})`}>
              <button onClick={() => setEditando(p.categorias.find(l => l.key === a.key) ?? null)}
                className="text-sm font-medium text-orange-600 hover:text-orange-700 transition-colors">Ajustar</button>
            </Linha>
          ))}
          {Object.entries(cenario.categorias).map(([key, aj]) => (
            <Linha key={`aj:${key}`} titulo={key.split('|')[1]}
              sub={`${MODOS.find(m => m.value === aj.modo)?.label}${aj.modo === 'valor' ? `: ${formatBRL(aj.valor ?? 0)}` : ''} · premissa sua`}>
              <button onClick={() => setAjusteCategoria(key, null)}
                className="text-sm text-gray-500 hover:text-gray-800 transition-colors">Voltar ao automático</button>
            </Linha>
          ))}
        </Bloco>

        <Extras cenario={cenario} setCenario={setCenario} opMeses={opMeses} imoveis={imoveis} />
      </div>

      {/* ── Tabela ──────────────────────────────────────────────────────── */}
      <section className="bg-white border border-gray-200 rounded-2xl">
        <div className="flex items-center gap-4 flex-wrap p-4 border-b border-gray-100 text-xs text-gray-500">
          <span className="text-sm font-medium text-gray-900">Por categoria</span>
          <span><span className="inline-block w-2 h-2 rounded-full bg-orange-500 mr-1.5 align-middle" />tem estimativa</span>
          <span><span className="inline-block w-2 h-2 rounded-full bg-sky-500 mr-1.5 align-middle" />premissa sua</span>
          <span className="ml-auto">Clique numa categoria para ajustar a projeção dela</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500">
                <th className="sticky left-0 bg-white text-left font-medium px-4 py-2.5 min-w-[220px] z-10" />
                {p.colunas.map((m, i) => (
                  <th key={m} className={`text-right font-medium px-3 py-2.5 whitespace-nowrap ${i === iAtual ? 'border-l border-gray-200' : ''}`}>
                    {rotuloMes(m)}
                    <span className="block text-[11px] font-normal text-gray-400">{i < iAtual ? 'real' : i === iAtual ? 'falta' : 'projeção'}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(['receita', 'despesa'] as Tipo[]).map(tipo => (
                <Grupo key={tipo} tipo={tipo} p={p} iAtual={iAtual} onEditar={setEditando} />
              ))}
              <tr className="border-t-2 border-gray-200 font-semibold">
                <td className="sticky left-0 bg-white px-4 py-2.5 z-10 text-gray-900">Resultado do mês</td>
                {p.resultado.map((v, i) => (
                  <td key={i} className={`text-right px-3 py-2.5 whitespace-nowrap ${i === iAtual ? 'border-l border-gray-200' : ''} ${v < 0 ? 'text-red-600' : 'text-gray-900'}`}>{formatBRL(v)}</td>
                ))}
              </tr>
              <tr className="border-t border-gray-100 font-semibold">
                <td className="sticky left-0 bg-white px-4 py-2.5 z-10 text-gray-900">Saldo no fim do mês</td>
                {p.saldo.map((v, i) => (
                  <td key={i} className={`text-right px-3 py-2.5 whitespace-nowrap ${i === iAtual ? 'border-l border-gray-200' : ''} ${v != null && v < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                    {v == null ? <span className="text-gray-300">—</span> : formatBRL(v)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <Modal open={!!editando} onClose={() => setEditando(null)} size="sm">
        {editando && (
          <AjusteModal linha={editando} onClose={() => setEditando(null)}
            onSalvar={a => { setAjusteCategoria(editando.key, a); setEditando(null) }} />
        )}
      </Modal>
    </div>
  )
}

function Grupo({ tipo, p, iAtual, onEditar }: {
  tipo: Tipo; p: NonNullable<ReturnType<typeof projetar>>; iAtual: number; onEditar: (l: LinhaCategoria) => void
}) {
  const [aberto, setAberto] = useState<Set<string>>(new Set())
  const linhas = p.categorias.filter(l => l.tipo === tipo)
  const premissas = p.premissas.filter(l => l.tipo === tipo)
  const totais = tipo === 'receita' ? p.receitas : p.despesas
  // Macro do maior para o menor pelo que pesa na projeção.
  const porMacro = new Map<string, LinhaCategoria[]>()
  for (const l of linhas) porMacro.set(l.macro, [...(porMacro.get(l.macro) ?? []), l])
  const peso = (ls: LinhaCategoria[]) => ls.reduce((s, l) => s + l.celulas.slice(iAtual).reduce((a, c) => a + c.total, 0) + l.mediana, 0)
  const macros = [...porMacro].sort((a, b) => peso(b[1]) - peso(a[1]))
  const somaCelulas = (ls: { celulas: Celula[] }[]) => p.colunas.map((_, i) => {
    const c: Celula = { total: 0, lancado: 0, estimado: 0, premissa: 0 }
    for (const l of ls) { const x = l.celulas[i]; c.total += x.total; c.estimado += x.estimado; c.premissa += x.premissa; c.lancado += x.lancado }
    return c
  })

  return (
    <>
      <tr className="border-t border-gray-200 bg-gray-50/70 font-semibold">
        <td className="sticky left-0 bg-gray-50 px-4 py-2.5 z-10 text-gray-900">{tipo === 'receita' ? 'Receitas' : 'Despesas'}</td>
        {totais.map((c, i) => <ValorCelula key={i} c={c} i={i} iAtual={iAtual} forte />)}
      </tr>
      {macros.map(([macro, ls]) => {
        const on = aberto.has(macro)
        return (
          <Fragment key={macro}>
            <tr className="border-t border-gray-100 hover:bg-gray-50/70 transition-colors">
              <td className="sticky left-0 bg-white px-4 py-2 z-10">
                <button onClick={() => setAberto(s => { const n = new Set(s); if (on) n.delete(macro); else n.add(macro); return n })}
                  className="flex items-center gap-1.5 text-gray-900 font-medium min-w-0">
                  <span className={`text-gray-400 text-xs transition-transform ${on ? 'rotate-90' : ''}`}>▶</span>
                  <span className="truncate">{macro}</span>
                </button>
              </td>
              {somaCelulas(ls).map((c, i) => <ValorCelula key={i} c={c} i={i} iAtual={iAtual} />)}
            </tr>
            {on && ls.sort((a, b) => peso([b]) - peso([a])).map(l => (
              <tr key={l.key} className="border-t border-gray-50 hover:bg-gray-50/70 transition-colors">
                <td className="sticky left-0 bg-white px-4 py-1.5 pl-9 z-10">
                  <button onClick={() => onEditar(l)} className="text-gray-700 hover:text-orange-600 transition-colors truncate max-w-[200px] text-left" title="Ajustar a projeção">
                    {l.categoria}
                  </button>
                </td>
                {l.celulas.map((c, i) => <ValorCelula key={i} c={c} i={i} iAtual={iAtual} fraco />)}
              </tr>
            ))}
          </Fragment>
        )
      })}
      {premissas.map(l => (
        <tr key={l.key} className="border-t border-gray-100">
          <td className="sticky left-0 bg-white px-4 py-2 z-10 text-sky-700 font-medium">{l.label}</td>
          {l.celulas.map((c, i) => <ValorCelula key={i} c={c} i={i} iAtual={iAtual} />)}
        </tr>
      ))}
    </>
  )
}

function ValorCelula({ c, i, iAtual, forte, fraco }: { c: Celula; i: number; iAtual: number; forte?: boolean; fraco?: boolean }) {
  const passado = i < iAtual
  const partes = [
    c.lancado ? `lançado ${formatBRL(c.lancado)}` : '',
    c.estimado ? `estimado ${formatBRL(c.estimado)}` : '',
    c.premissa ? `premissa ${formatBRL(c.premissa)}` : '',
  ].filter(Boolean)
  return (
    <td title={passado ? 'realizado' : partes.join(' · ')}
      className={`text-right px-3 whitespace-nowrap tabular-nums ${fraco ? 'py-1.5' : 'py-2'} ${i === iAtual ? 'border-l border-gray-200' : ''} ${passado ? 'text-gray-400' : forte ? 'text-gray-900' : fraco ? 'text-gray-600' : 'text-gray-800'}`}>
      {c.total ? formatBRL(c.total) : <span className="text-gray-300">—</span>}
      {!passado && (c.estimado > 0.5 || c.premissa > 0.5) && (
        <span className={`inline-block w-1.5 h-1.5 rounded-full ml-1.5 align-middle ${c.premissa > 0.5 ? 'bg-sky-500' : 'bg-orange-500'}`} />
      )}
    </td>
  )
}

function AjusteModal({ linha, onClose, onSalvar }: { linha: LinhaCategoria; onClose: () => void; onSalvar: (a: AjusteCategoria | null) => void }) {
  const [modo, setModo] = useState<ModoCategoria>(linha.ajuste?.modo ?? 'auto')
  const [valor, setValor] = useState(linha.ajuste?.valor ?? Math.round(linha.mediana))
  return (
    <>
      <ModalHeader title={linha.categoria} onClose={onClose} />
      <div className="px-6 pb-6 space-y-4">
        <p className="text-sm text-gray-500">
          {linha.recorrente
            ? `Nos últimos ${MESES_HISTORICO} meses fechados ${linha.tipo === 'receita' ? 'entrou' : 'saiu'}, na mediana, ${formatBRL(linha.mediana)} por mês.`
            : `Não é recorrente nos últimos ${MESES_HISTORICO} meses: a projeção usa só o que está lançado.`}
        </p>
        <Select value={modo} onChange={v => setModo(v as ModoCategoria)} options={MODOS} />
        {modo === 'valor' && <ValorInput valor={valor} onChange={setValor} largo />}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors">Cancelar</button>
          <button onClick={() => onSalvar(modo === 'auto' ? null : { modo, valor: modo === 'valor' ? valor : undefined })}
            className="px-4 py-2 text-sm font-medium rounded-xl bg-orange-600 text-[#fff] hover:bg-orange-700 active:scale-[0.97] transition-[background-color,transform]">
            Aplicar
          </button>
        </div>
      </div>
    </>
  )
}

function Extras({ cenario, setCenario, opMeses, imoveis }: {
  cenario: Cenario; setCenario: React.Dispatch<React.SetStateAction<Cenario>>
  opMeses: { value: string; label: string }[]; imoveis: number
}) {
  const [desc, setDesc] = useState('')
  const [tipo, setTipo] = useState<Tipo>('receita')
  const [valor, setValor] = useState(0)
  const [mes, setMes] = useState(opMeses[0]?.value ?? '')
  const [parcelas, setParcelas] = useState(1)
  const adicionar = () => {
    if (!valor || !mes) return
    setCenario(c => ({ ...c, extras: [...c.extras, { id: crypto.randomUUID(), descricao: desc.trim(), tipo, valor, mes, parcelas }] }))
    setDesc(''); setValor(0); setParcelas(1)
  }
  return (
    <Bloco titulo="Entradas e saídas extraordinárias" n={cenario.extras.length}
      dica={`Venda de imóvel, aporte, corte pontual.${imoveis > 0 ? ` Imóveis cadastrados: ${formatBRL(imoveis)} (não entram no caixa).` : ''}`}>
      {cenario.extras.map(e => (
        <Linha key={e.id} titulo={`${e.tipo === 'receita' ? '+' : '−'} ${formatBRL(e.valor)} · ${e.descricao || 'sem descrição'}`}
          sub={`${e.parcelas > 1 ? `${e.parcelas}x a partir de` : 'em'} ${rotuloMes(e.mes)}`}>
          <button aria-label="Remover" onClick={() => setCenario(c => ({ ...c, extras: c.extras.filter(x => x.id !== e.id) }))}
            className="p-1.5 text-gray-400 hover:text-red-600 transition-colors"><Trash2 className="w-4 h-4" /></button>
        </Linha>
      ))}
      <div className="flex items-center gap-2 flex-wrap pt-2">
        <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Descrição"
          className="flex-1 min-w-[140px] bg-gray-100 border border-transparent rounded-xl px-3 py-1.5 text-sm focus:bg-white focus:border-gray-300 outline-none transition-colors" />
        <div className="w-28"><Select size="sm" value={tipo} onChange={v => setTipo(v as Tipo)} options={[{ value: 'receita', label: 'Entrada' }, { value: 'despesa', label: 'Saída' }]} /></div>
        <ValorInput valor={valor} onChange={setValor} />
        <div className="w-24"><Select size="sm" value={mes} onChange={setMes} options={opMeses} /></div>
        <div className="w-24"><Select size="sm" value={String(parcelas)} onChange={v => setParcelas(Number(v))}
          options={[1, 2, 3, 4, 6, 12].map(n => ({ value: String(n), label: n === 1 ? 'à vista' : `${n}x` }))} /></div>
        <button onClick={adicionar} disabled={!valor}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-xl bg-orange-600 text-[#fff] hover:bg-orange-700 disabled:opacity-40 active:scale-[0.97] transition-[background-color,transform,opacity]">
          <Plus className="w-4 h-4" /> Incluir
        </button>
      </div>
    </Bloco>
  )
}

function ValorInput({ valor, onChange, largo }: { valor: number; onChange: (v: number) => void; largo?: boolean }) {
  const [txt, setTxt] = useState(valor ? String(valor).replace('.', ',') : '')
  useEffect(() => { setTxt(valor ? String(valor).replace('.', ',') : '') }, [valor]) // eslint-disable-line react-hooks/set-state-in-effect
  return (
    <div className={`relative ${largo ? 'w-full' : 'w-32'}`}>
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">R$</span>
      <input inputMode="decimal" value={txt} onChange={e => setTxt(e.target.value)} onBlur={() => onChange(parseValor(txt))}
        onKeyDown={e => { if (e.key === 'Enter') onChange(parseValor(txt)) }}
        className="w-full bg-gray-100 border border-transparent rounded-xl pl-8 pr-3 py-1.5 text-sm text-right tabular-nums focus:bg-white focus:border-gray-300 outline-none transition-colors" />
    </div>
  )
}

function Bloco({ titulo, dica, vazio, n, children }: { titulo: string; dica?: string; vazio?: string; n: number; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-4">
      <h2 className="text-sm font-semibold text-gray-900">{titulo}</h2>
      {dica && <p className="text-xs text-gray-500 mt-0.5">{dica}</p>}
      <div className="mt-3 divide-y divide-gray-100">
        {n === 0 && vazio && !hasChildren(children) ? <p className="text-sm text-gray-400 py-2">{vazio}</p> : children}
      </div>
    </section>
  )
}
const hasChildren = (c: React.ReactNode) => (Array.isArray(c) ? c.flat(Infinity).some(Boolean) : !!c)

function Linha({ titulo, sub, aviso, children }: { titulo: string; sub?: string; aviso?: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-900 truncate flex items-center gap-1.5">
          {aviso && <TrendingDown className="w-3.5 h-3.5 text-amber-500 shrink-0" />}{titulo}
        </p>
        {sub && <p className="text-xs text-gray-500">{sub}</p>}
      </div>
      {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
    </div>
  )
}

function Kpi({ label, valor, dica, alerta }: { label: string; valor: string; dica?: string; alerta?: boolean }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3">
      <span className="text-xs text-gray-500">{label}</span>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${alerta ? 'text-red-600' : 'text-gray-900'}`}>{valor}</p>
      {dica && <p className="text-[11px] text-gray-400 mt-0.5 truncate" title={dica}>{dica}</p>}
    </div>
  )
}

function Leg({ cor, label, linha }: { cor: string; label: string; linha?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={linha ? 'w-4 h-0.5 rounded-full' : 'w-2.5 h-2.5 rounded-[3px]'} style={{ background: cor }} />{label}
    </span>
  )
}
