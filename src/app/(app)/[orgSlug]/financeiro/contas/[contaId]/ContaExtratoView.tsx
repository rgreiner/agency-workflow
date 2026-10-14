'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown, ArrowDownCircle, ArrowUpCircle, Plug, Check, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBRL, formatDateBR } from '@/lib/midia'
import { DocChip } from '@/components/ui/DocChip'

export interface Mov {
  data: string | null
  contato: string | null
  descricao: string | null
  categoria: string | null
  valor: number          // com sinal (despesa negativa), como vem do extrato
  situacao: string | null
  origem: string         // 'extrato' (Conta Azul) | 'flow' (baixa de lançamento)
  // Documento que originou a cobrança (só nas baixas do Flow) — MX 1567, PP 1783, FEE 34.
  docId?: string | null
  docSerie?: string | null
  docNumero?: number | null
  docOrigem?: string | null
  docProducaoTipo?: string | null
}

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const REALIZADO = new Set(['Conciliado', 'Quitado', 'Transferido', 'Pago', 'Recebido'])
const monthOf = (d: string | null) => (d ? d.slice(0, 7) : null)
function monthLabel(ym: string) { const [y, m] = ym.split('-'); return `${MESES[Number(m) - 1]} ${y}` }
function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
function corSituacao(s: string | null): string {
  if (!s) return 'bg-gray-100 text-gray-500'
  if (REALIZADO.has(s)) return 'bg-emerald-50 text-emerald-700'
  if (s === 'Em aberto' || s === 'Atrasado') return 'bg-amber-50 text-amber-700'
  return 'bg-gray-100 text-gray-500'
}

/** Curva do saldo realizado. Ocupa o vão do cabeçalho com informação de verdade:
 *  o número diz onde a conta está, a linha diz como ela chegou aqui. */
function SaldoSparkline({ pontos }: { pontos: { data: string; saldo: number }[] }) {
  if (pontos.length < 2) return null
  const vals = pontos.map(p => p.saldo)
  const min = Math.min(...vals), max = Math.max(...vals)
  const span = max - min || Math.abs(max) || 1
  const W = 100, H = 34
  const xy = pontos.map((p, i) => {
    const x = (i / (pontos.length - 1)) * W
    const y = H - ((p.saldo - min) / span) * (H - 4) - 2
    return [x, y] as const
  })
  const line = xy.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const area = `0,${H} ${line} ${W},${H}`
  const subiu = vals[vals.length - 1] >= vals[0]
  const cor = subiu ? '#10b981' : '#ef4444'
  const [lx, ly] = xy[xy.length - 1]

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-[42px] overflow-visible" aria-hidden>
        <polygon points={area} fill={cor} opacity={0.08} />
        <polyline points={line} fill="none" stroke={cor} strokeWidth={1.5}
          vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={lx} cy={ly} r={2} fill={cor} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] text-gray-400 tabular-nums mt-0.5">
        <span>{formatDateBR(pontos[0].data)}</span>
        <span className="text-gray-300">saldo realizado</span>
        <span>{formatDateBR(pontos[pontos.length - 1].data)}</span>
      </div>
    </div>
  )
}

function Stat({ label, valor, cor }: { label: string; valor: string; cor?: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-gray-400 leading-none mb-1">{label}</p>
      <p className={cn('text-sm font-semibold tabular-nums', cor ?? 'text-gray-900')}>{valor}</p>
    </div>
  )
}

export function ContaExtratoView({ orgSlug, movimentos, saldoInicial, saldoAtual, saldoBanco, saldoBancoData, temOfx, bancoPorDia = {}, divergencia = null, today, pendentesCount = 0, slotConciliacao, slotIntegracao }: {
  orgSlug: string
  movimentos: Mov[]; saldoInicial: number; saldoAtual: number
  saldoBanco: number | null; saldoBancoData: string | null
  temOfx: boolean; today: string
  /** Líquido do dia no banco (OFX), para apontar o dia em que o Flow diverge. */
  bancoPorDia?: Record<string, number>
  /** Banco × Flow na data do extrato (mig. 347). null = conta sem OFX. */
  divergencia?: { diferenca: number; real: number; pendentes: number; desde: string | null } | null
  /** Quantos movimentos do banco esperam ação. 0 = a conciliação vira uma linha
   *  discreta em vez de um bloco inteiro dizendo que não há nada pra fazer. */
  pendentesCount?: number
  slotConciliacao?: React.ReactNode
  /** Integração bancária desta conta (migration 128) — fica no fim, é configuração. */
  slotIntegracao?: React.ReactNode
}) {
  const months = useMemo(() => {
    const set = new Set<string>()
    for (const m of movimentos) { const ym = monthOf(m.data); if (ym) set.add(ym) }
    return [...set].sort().reverse()
  }, [movimentos])

  const [mes, setMes] = useState(() => {
    const tm = today.slice(0, 7)
    if (months.includes(tm)) return tm
    const past = months.filter(m => m <= tm)
    return past[0] ?? months[0] ?? tm
  })
  const [conciliacaoAberta, setConciliacaoAberta] = useState(false)

  // Saldo realizado ao fim de cada dia. O saldo atual NÃO é recalculado aqui — vem da
  // view contas_saldo, fonte única compartilhada com a lista de contas e o painel.
  // Só chega movimento realizado do servidor (extrato conciliado + baixas do Flow),
  // então o acumulado não precisa mais filtrar por situação.
  const saldoAteDia = useMemo(() => {
    const sorted = movimentos.filter(m => m.data).sort((a, b) => (a.data! < b.data! ? -1 : a.data! > b.data! ? 1 : 0))
    let acc = saldoInicial
    const map = new Map<string, number>()
    for (const m of sorted) { acc += m.valor; map.set(m.data!, acc) }
    return map
  }, [movimentos, saldoInicial])

  // Série da curva: os últimos dias COM movimento (não os últimos N dias do
  // calendário — a conta tem dias parados e eles achatariam o desenho).
  const serie = useMemo(() => {
    const pts = [...saldoAteDia.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([data, saldo]) => ({ data, saldo }))
    return pts.slice(-45)
  }, [saldoAteDia])

  // Dia a dia, banco × Flow — só onde há OFX (antes dele não há com o que
  // comparar). Abaixo de R$ 1 é centavo de rendimento arredondado, não erro.
  const divergencias = useMemo(() => {
    const diasOfx = Object.keys(bancoPorDia)
    if (diasOfx.length === 0) return new Map<string, { banco: number; flow: number; dif: number }>()
    const inicio = diasOfx.sort()[0]
    const flowPorDia = new Map<string, number>()
    for (const m of movimentos) if (m.data && m.data >= inicio) flowPorDia.set(m.data, (flowPorDia.get(m.data) ?? 0) + m.valor)
    const out = new Map<string, { banco: number; flow: number; dif: number }>()
    for (const d of new Set([...diasOfx, ...flowPorDia.keys()])) {
      const banco = bancoPorDia[d] ?? 0, flow = flowPorDia.get(d) ?? 0
      const dif = Math.round((flow - banco) * 100) / 100
      if (Math.abs(dif) >= 1) out.set(d, { banco, flow, dif })
    }
    return out
  }, [bancoPorDia, movimentos])
  const diasDivergentes = useMemo(() => [...divergencias.keys()].sort(), [divergencias])

  function irParaDia(d: string) {
    setMes(d.slice(0, 7))
    // Espera o mês renderizar antes de rolar até o dia.
    setTimeout(() => document.getElementById(`dia-${d}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
  }

  const { dias, entradasMes, saidasMes } = useMemo(() => {
    const noMes = movimentos.filter(m => monthOf(m.data) === mes)
    let ent = 0, sai = 0
    for (const m of noMes) { if (m.valor > 0) ent += m.valor; else sai += -m.valor }
    const byDay = new Map<string, Mov[]>()
    for (const m of noMes) { const k = m.data as string; const arr = byDay.get(k) ?? []; arr.push(m); byDay.set(k, arr) }
    // Dia em que o banco mexeu e o Flow não tem nada também precisa aparecer —
    // é justamente o dia que se procura.
    for (const d of divergencias.keys()) if (monthOf(d) === mes && !byDay.has(d)) byDay.set(d, [])
    const dias = [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([data, itens]) => ({ data, itens, saldo: saldoAteDia.get(data) ?? null }))
    return { dias, entradasMes: ent, saidasMes: sai }
  }, [movimentos, mes, saldoAteDia, divergencias])

  const resultadoMes = entradasMes - saidasMes
  // Compara na MESMA data do extrato (vem do servidor). Sem isso, toda baixa feita
  // depois do último OFX aparecia como diferença — e alarme falso ensina a não olhar.
  const diff = divergencia ? divergencia.diferenca : null
  const bate = diff !== null && Math.abs(diff) < 0.01
  // O que sobra depois de descontar a fila de conciliação: isso é erro e grita.
  // O resto da diferença é só trabalho do dia (conciliar os pendentes).
  const real = divergencia ? divergencia.real : null
  const erro = real !== null && Math.abs(real) >= 0.01

  // Link do card de Contas chega com #dia-AAAA-MM-DD: abre o mês e rola até o dia.
  useEffect(() => {
    const m = /^#dia-(\d{4}-\d{2}-\d{2})$/.exec(window.location.hash)
    if (!m) return
    // Fora do corpo do efeito: o hash só existe no navegador, depois da hidratação.
    const t = setTimeout(() => irParaDia(m[1]), 0)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="p-6 space-y-4">
      {/* ── CABEÇALHO ÚNICO: saldo, curva, banco e o mês em uma peça só ──────
          Antes eram três cartões empilhados (saldo · conciliação · mês), cada um
          com um número solto num vão enorme. */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(190px,auto)_1fr_minmax(190px,auto)] gap-6 px-5 py-4 items-center">
          <div>
            <p className="text-xs font-medium text-gray-400 mb-1">Saldo atual</p>
            <p className={cn('text-3xl font-semibold tabular-nums leading-none', saldoAtual < 0 ? 'text-red-600' : 'text-gray-900')}>
              {formatBRL(saldoAtual)}
            </p>
            <p className="text-[11px] text-gray-400 mt-1.5">Realizado do extrato + baixas do Flow</p>
          </div>

          {/* O vão vira a trajetória da conta. */}
          <div className="min-w-0 hidden lg:block"><SaldoSparkline pontos={serie} /></div>

          {saldoBanco != null ? (
            <div className="lg:text-right lg:border-l lg:border-gray-100 lg:pl-6">
              <p className="text-xs font-medium text-gray-400 mb-1">No banco</p>
              <p className="text-lg font-semibold text-gray-700 tabular-nums leading-none">{formatBRL(saldoBanco)}</p>
              <span className={cn('inline-flex items-center gap-1 mt-2 text-[11px] font-medium rounded-full px-2 py-0.5',
                bate ? 'bg-emerald-50 text-emerald-700' : erro ? 'bg-red-100 text-red-700' : 'bg-amber-50 text-amber-700')}>
                {bate ? <Check className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                {bate ? 'Bate com o Flow' : erro ? `Difere em ${formatBRL(Math.abs(real ?? 0))}` : `${divergencia?.pendentes ?? 0} a conciliar`}
              </span>
              {saldoBancoData && <p className="text-[11px] text-gray-400 mt-1">extrato de {formatDateBR(saldoBancoData)}</p>}
              {diasDivergentes.length > 0 && (
                <div className="mt-2 flex flex-wrap lg:justify-end items-center gap-1">
                  <span className="text-[11px] text-gray-400">{diasDivergentes.length === 1 ? 'Dia que não bate:' : 'Dias que não batem:'}</span>
                  {diasDivergentes.slice(0, 6).map(d => (
                    <button key={d} type="button" onClick={() => irParaDia(d)}
                      title={`Diferença de ${formatBRL(divergencias.get(d)!.dif)} neste dia`}
                      className="text-[11px] font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-full px-2 py-0.5 tabular-nums transition-colors active:scale-[0.97]">
                      {formatDateBR(d).slice(0, 5)}
                    </button>
                  ))}
                  {diasDivergentes.length > 6 && <span className="text-[11px] text-gray-400">+{diasDivergentes.length - 6}</span>}
                </div>
              )}
            </div>
          ) : (
            <div className="lg:text-right lg:border-l lg:border-gray-100 lg:pl-6">
              <p className="text-xs font-medium text-gray-400 mb-1">No banco</p>
              <p className="text-sm text-gray-400">sem extrato importado</p>
            </div>
          )}
        </div>

        {/* Faixa do mês: seletor e os números do período na MESMA linha. */}
        <div className="flex items-center gap-5 flex-wrap px-5 py-3 border-t border-gray-100 bg-gray-50/60">
          <div className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5">
            <button onClick={() => setMes(m => shiftMonth(m, -1))} aria-label="Mês anterior"
              className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition-colors active:scale-[0.97]"><ChevronLeft className="w-4 h-4" /></button>
            <span className="px-2.5 text-sm font-medium text-gray-800 min-w-[110px] text-center">{monthLabel(mes)}</span>
            <button onClick={() => setMes(m => shiftMonth(m, 1))} aria-label="Próximo mês"
              className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition-colors active:scale-[0.97]"><ChevronRight className="w-4 h-4" /></button>
          </div>
          <Stat label="Entrou" valor={formatBRL(entradasMes)} cor="text-emerald-600" />
          <Stat label="Saiu" valor={formatBRL(saidasMes)} cor="text-red-600" />
          <Stat label="Resultado" valor={formatBRL(resultadoMes)} cor={resultadoMes < 0 ? 'text-red-600' : 'text-gray-900'} />
          <Stat label="Movimentos" valor={String(dias.reduce((s, d) => s + d.itens.length, 0))} />
        </div>
      </div>

      {/* Saldo diferente do banco: faixa no topo, vermelha, com o dia em que
          começou. Fica até bater — é trabalho a fazer, não informação. */}
      {erro && real !== null && (
        <div role="alert" className="flex items-center gap-3 flex-wrap rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="w-5 h-5 shrink-0 text-red-600" />
          <span className="flex-1 min-w-0">
            <strong className="font-semibold">O saldo do Flow não bate com o banco: {formatBRL(Math.abs(real))}</strong>
            {' '}({real > 0 ? 'Flow acima' : 'Flow abaixo'} do extrato de {saldoBancoData ? formatDateBR(saldoBancoData) : '—'}
            {divergencia && divergencia.pendentes > 0 ? `, já descontados ${divergencia.pendentes} movimento(s) na fila de conciliação` : ''}).
            {divergencia?.desde && <> A diferença começa em <strong className="font-semibold">{formatDateBR(divergencia.desde)}</strong>.</>}
          </span>
          {divergencia?.desde && (
            <button type="button" onClick={() => irParaDia(divergencia.desde!)}
              className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-[#fff] hover:bg-red-700 transition-colors active:scale-[0.97]">
              Ir para {formatDateBR(divergencia.desde).slice(0, 5)}
            </button>
          )}
        </div>
      )}

      {/* Aviso OFX (some quando houver extrato bancário) */}
      {!temOfx && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-100 px-4 py-2.5 text-sm text-amber-800">
          <Plug className="w-4 h-4 shrink-0" />
          Sem OFX importado — o saldo do banco e a conciliação aparecem aqui quando você importar o extrato.
        </div>
      )}

      {/* A CONCILIAR — bloco inteiro só quando há o que fazer. Sem pendência vira
          uma linha: dizer "nada a fazer" não merece um cartão de 150px. */}
      {slotConciliacao && (pendentesCount > 0 ? (
        // `id` é o alvo do "N a conciliar" na lista de Contas — sem ele o chip
        // levaria ao topo da página e a pessoa procuraria o bloco com o olho.
        <div id="conciliacao" className="scroll-mt-4">{slotConciliacao}</div>
      ) : (
        <div id="conciliacao" className="scroll-mt-4 bg-white rounded-xl border border-gray-200 overflow-hidden">
          <button onClick={() => setConciliacaoAberta(o => !o)}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors">
            <Check className="w-4 h-4 text-emerald-500 shrink-0" />
            <span className="text-gray-600"><strong className="font-medium text-gray-900">Tudo conciliado</strong> · nenhum movimento do banco pendente</span>
            <ChevronDown className={cn('w-4 h-4 text-gray-400 ml-auto transition-transform', conciliacaoAberta && 'rotate-180')} />
          </button>
          {conciliacaoAberta && <div className="px-4 pb-4 pt-1 border-t border-gray-100">{slotConciliacao}</div>}
        </div>
      ))}

      {/* Extrato por dia — grade real: o valor deixa de flutuar longe da descrição
          e as etiquetas ocupam o meio, que era só vão. */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {dias.map(dia => {
          const dv = divergencias.get(dia.data)
          return (
          <div key={dia.data} id={`dia-${dia.data}`} className="scroll-mt-24">
            <div className={cn('flex items-center justify-between gap-3 flex-wrap px-4 py-2 border-t first:border-t-0',
              dv ? 'bg-amber-50 border-amber-100' : 'bg-gray-50/70 border-gray-100')}>
              <span className={cn('text-xs font-medium', dv ? 'text-amber-800' : 'text-gray-500')}>{formatDateBR(dia.data)}</span>
              {dv && (
                // Os três números juntos dizem o que procurar: o líquido do dia no
                // banco, o do Flow, e quanto o Flow ficou acima/abaixo nesse dia.
                <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-800 tabular-nums">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>banco {formatBRL(dv.banco)} · Flow {formatBRL(dv.flow)}</span>
                  <strong className="font-semibold">Flow {formatBRL(Math.abs(dv.dif))} {dv.dif > 0 ? 'acima' : 'abaixo'} do banco</strong>
                </span>
              )}
              {dia.saldo != null && <span className={cn('text-[11px] tabular-nums', dv ? 'text-amber-700/70' : 'text-gray-400')}>saldo do dia {formatBRL(dia.saldo)}</span>}
            </div>
            {dia.itens.map((m, i) => (
              <div key={i}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[auto_minmax(0,22rem)_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2.5 border-t border-gray-50 hover:bg-gray-50/60 transition-colors">
                {m.valor < 0
                  ? <ArrowUpCircle className="w-4 h-4 text-red-400 shrink-0" />
                  : <ArrowDownCircle className="w-4 h-4 text-emerald-500 shrink-0" />}

                <div className="min-w-0">
                  <div className="text-sm text-gray-800 truncate">{m.contato || m.descricao || '—'}</div>
                  {m.contato && m.descricao && (
                    <div className="text-[11px] text-gray-400 truncate">{m.descricao}</div>
                  )}
                </div>

                {/* Etiquetas ganham coluna própria em vez de se espremer sob o título. */}
                <div className="hidden sm:flex flex-wrap items-center gap-1 min-w-0">
                  <DocChip orgSlug={orgSlug} doc={{ id: m.docId ?? null, serie: m.docSerie ?? null, numero: m.docNumero ?? null, origem: m.docOrigem ?? null, producaoTipo: m.docProducaoTipo }} />
                  {m.categoria && <span className="text-[10px] text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">{m.categoria}</span>}
                  {m.situacao && <span className={cn('text-[10px] font-medium rounded-full px-2 py-0.5', corSituacao(m.situacao))}>{m.situacao}</span>}
                </div>

                <span className={cn('text-sm font-medium tabular-nums whitespace-nowrap text-right', m.valor < 0 ? 'text-red-600' : 'text-gray-900')}>
                  {formatBRL(m.valor)}
                </span>
              </div>
            ))}
          </div>
          )
        })}
        {dias.length === 0 && (
          <p className="text-sm text-gray-400 px-4 py-12 text-center">
            Nenhum movimento realizado em {monthLabel(mes)}.
            <span className="block text-[11px] mt-1">O previsto fica em Lançamentos.</span>
          </p>
        )}
      </div>

      {/* INTEGRAÇÃO — configuração da conta, fica no fim */}
      {slotIntegracao}
    </div>
  )
}
