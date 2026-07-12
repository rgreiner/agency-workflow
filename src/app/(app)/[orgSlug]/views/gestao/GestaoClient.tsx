'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import { MultiSelect, Select } from '@/components/ui/Select'
import { useStatusConfig } from '@/components/ui/StatusBadge'
import { AlertTriangle, UserX, CalendarOff, PauseCircle, Loader2, Activity as ActivityIcon, X, ExternalLink, ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { formatBRL } from '@/lib/midia'
import { DRE_TEMPLATE, type DreLine } from '@/lib/dre-template'

export interface ProblemTask { status: string; ws_id: string; ws_name: string; assignees: string[]; dias: number }
export interface CargaRow { user_id: string; full_name: string | null; avatar_url: string | null; ativas: number; horas: number }
export interface FunilRow { status: string; n: number }
export interface GestaoData {
  total_ativas: number
  n_atrasadas: number; n_sem_responsavel: number; n_sem_prazo: number; n_paradas: number
  atrasadas: ProblemTask[]; paradas: ProblemTask[]
  carga: CargaRow[]; funil: FunilRow[]
}
export interface EngUser { user_id: string; full_name: string | null; avatar_url: string | null; total: number; por_tipo: Record<string, number> }
export interface EngDaily { user_id: string; day: string; n: number }
export interface EngajamentoData { since: string; until: string; days: number; users: EngUser[]; daily: EngDaily[] }
export interface TipoTotal { tipo: string; n: number; total: number }
export interface NTotal { n: number; total: number }
export interface CatMesV { categoria: string; mes: string; v: number }
export interface FinanceiroData {
  mes: string
  a_receber: number; a_pagar: number; recebido: number; pago: number
  a_receber_atrasado: number; a_pagar_atrasado: number
  producao_pendente: NTotal; producao_faturar: NTotal
  midia_pendente: NTotal; midia_por_tipo: TipoTotal[]
  dre_meses: string[]
  dre_real: CatMesV[]; dre_prev: CatMesV[]
}

const DIAS_OPTIONS = [
  { value: '28', label: '4 semanas' },
  { value: '84', label: '12 semanas' },
  { value: '182', label: '6 meses' },
  { value: '364', label: '1 ano' },
]
const KIND_LABEL: Record<string, string> = { status: 'status', campo: 'campos', comentario: 'comentários', reacao: 'reações' }

export function GestaoClient({
  orgSlug, workspaces, wsFilter, dias, mes, aba: abaInicial, gestao, engajamento, financeiro,
}: {
  orgSlug: string
  workspaces: { id: string; name: string }[]
  wsFilter: string[]
  dias: number
  mes: string
  aba: 'operacao' | 'engajamento' | 'financeiro'
  gestao: GestaoData | null
  engajamento: EngajamentoData | null
  financeiro: FinanceiroData | null
}) {
  const router = useRouter()
  const [aba, setAba] = useState(abaInicial)
  const [pending, start] = useTransition()

  function pushParams(patch: { ws?: string[]; dias?: number; mes?: string }) {
    const ws = patch.ws ?? wsFilter
    const d = patch.dias ?? dias
    const m = patch.mes ?? mes
    const params = new URLSearchParams()
    if (ws.length) params.set('ws', ws.join(','))
    if (d !== 84) params.set('dias', String(d))
    if (m !== nowMonth()) params.set('mes', m)
    if (aba !== 'operacao') params.set('aba', aba)
    start(() => router.push(`/${orgSlug}/views/gestao${params.toString() ? `?${params}` : ''}`))
  }

  return (
    <div className="p-6 max-w-6xl">
      {/* Abas + filtro da aba ativa na mesma linha */}
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div className="inline-flex bg-gray-100 rounded-xl p-0.5">
          {([['operacao', 'Operação'], ['engajamento', 'Engajamento'], ['financeiro', 'Financeiro']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setAba(v)} aria-pressed={aba === v}
              className={cn('px-3.5 py-1.5 text-sm font-medium rounded-[10px] transition-colors',
                aba === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {pending && <Loader2 className="w-4 h-4 text-gray-300 animate-spin" />}
          {aba === 'operacao' && (
            <>
              {workspaces.length > 1 && (
                <div className="w-48"><MultiSelect values={wsFilter} onChange={ws => pushParams({ ws })} allLabel="Todos os clientes"
                  options={workspaces.map(w => ({ value: w.id, label: w.name }))} /></div>
              )}
              {gestao && <span className="text-sm text-gray-400 whitespace-nowrap">{gestao.total_ativas} ativas</span>}
            </>
          )}
          {aba === 'engajamento' && (
            <div className="w-40"><Select value={String(dias)} onChange={v => pushParams({ dias: parseInt(v, 10) })} options={DIAS_OPTIONS} /></div>
          )}
          {aba === 'financeiro' && (
            <div className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5">
              <button onClick={() => pushParams({ mes: shiftMonth(mes, -1) })} className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition"><ChevronLeft className="w-4 h-4" /></button>
              <span className="px-3 text-sm font-medium text-gray-800 min-w-[110px] text-center">{monthLabel(mes)}</span>
              <button onClick={() => pushParams({ mes: shiftMonth(mes, 1) })} className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 transition"><ChevronRight className="w-4 h-4" /></button>
            </div>
          )}
        </div>
      </div>

      {aba === 'operacao' && <Operacao orgSlug={orgSlug} gestao={gestao} />}
      {aba === 'engajamento' && <Engajamento engajamento={engajamento} />}
      {aba === 'financeiro' && <Financeiro orgSlug={orgSlug} fin={financeiro} />}
    </div>
  )
}

// ── Operação (3.1) — analítico: onde e com quem a pauta trava ────────────────
function Operacao({ orgSlug, gestao }: { orgSlug: string; gestao: GestaoData | null }) {
  const statusConfig = useStatusConfig()
  const [person, setPerson] = useState<string | null>(null)  // uid | 'none' (sem responsável) | null
  if (!gestao) return <p className="text-sm text-gray-400">Sem dados.</p>

  const people = new Map(gestao.carga.map(c => [c.user_id, c]))

  // Ranking por pessoa (sobre TODAS as atrasadas — é o seletor de avatar).
  const pc = new Map<string, number>(); let semResp = 0
  for (const t of gestao.atrasadas) {
    if (t.assignees.length === 0) semResp++
    else for (const u of t.assignees) pc.set(u, (pc.get(u) ?? 0) + 1)
  }
  const ranking = [...pc.entries()].map(([uid, n]) => ({ uid, n, p: people.get(uid) })).sort((a, b) => b.n - a.n)

  // Recorte por pessoa aplicado aos demais painéis.
  const match = (t: ProblemTask) => person == null || (person === 'none' ? t.assignees.length === 0 : t.assignees.includes(person))
  const atr = gestao.atrasadas.filter(match)
  const par = gestao.paradas.filter(match)

  const etapaAtr = countBy(atr, t => t.status)
  const etapaPar = countBy(par, t => t.status)
  const cliente = new Map<string, { name: string; n: number }>()
  for (const t of atr) { const e = cliente.get(t.ws_id) ?? { name: t.ws_name, n: 0 }; e.n++; cliente.set(t.ws_id, e) }
  const sev = { s1: 0, s2: 0, s3: 0, s4: 0 }
  for (const t of atr) { const d = t.dias; if (d <= 3) sev.s1++; else if (d <= 7) sev.s2++; else if (d <= 30) sev.s3++; else sev.s4++ }

  const etapaRows = statusConfig.filter(s => etapaAtr.has(s.value)).map(s => ({ cfg: s, n: etapaAtr.get(s.value)! })).sort((a, b) => b.n - a.n)
  const paradasRows = statusConfig.filter(s => etapaPar.has(s.value)).map(s => ({ cfg: s, n: etapaPar.get(s.value)! })).sort((a, b) => b.n - a.n)
  const cliRows = [...cliente.entries()].map(([ws_id, e]) => ({ ws_id, ...e })).sort((a, b) => b.n - a.n)

  const funilOrdered = statusConfig
    .map(s => ({ cfg: s, row: gestao.funil.find(f => f.status === s.value) }))
    .filter(x => x.row) as { cfg: typeof statusConfig[number]; row: FunilRow }[]

  function href(q: { status?: string; ws?: string; overdue?: boolean; noduedate?: boolean }) {
    const p = new URLSearchParams()
    if (person && person !== 'none') p.set('persons', person)
    if (q.status) p.set('statuses', q.status)
    if (q.ws) p.set('ws', q.ws)
    if (q.overdue) p.set('date', 'overdue')
    if (q.noduedate) p.set('date', 'noduedate')
    return `/${orgSlug}/views/lista?${p.toString()}`
  }

  const selName = person === 'none' ? 'Sem responsável' : person ? (people.get(person)?.full_name ?? 'pessoa') : null

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Atrasadas" n={gestao.n_atrasadas} icon={AlertTriangle} tone="red" href={href({ overdue: true })} />
        <Kpi label="Sem responsável" n={gestao.n_sem_responsavel} icon={UserX} tone="amber" onClick={() => setPerson(person === 'none' ? null : 'none')} active={person === 'none'} />
        <Kpi label="Paradas +7 dias" n={gestao.n_paradas} icon={PauseCircle} tone="orange" />
        <Kpi label="Sem prazo" n={gestao.n_sem_prazo} icon={CalendarOff} tone="gray" href={href({ noduedate: true })} />
      </div>

      {/* Quem: seletor de avatar (ranking de atraso por pessoa) */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Quem acumula atraso</h3>
          {person && <button onClick={() => setPerson(null)} className="inline-flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700"><X className="w-3 h-3" /> limpar filtro</button>}
        </div>
        {ranking.length === 0 && semResp === 0 ? <p className="text-sm text-gray-400">Ninguém com atraso. 🎉</p> : (
          <div className="flex items-center gap-2 flex-wrap">
            {ranking.map(r => {
              const sel = person === r.uid
              return (
                <button key={r.uid} onClick={() => setPerson(sel ? null : r.uid)}
                  className={cn('inline-flex items-center gap-2 rounded-full border pl-1 pr-3 py-1 transition', sel ? 'border-orange-300 bg-orange-50' : 'border-gray-200 hover:bg-gray-50')}>
                  <Avatar name={r.p?.full_name ?? null} avatarUrl={r.p?.avatar_url ?? null} />
                  <span className="text-xs text-gray-700 max-w-[120px] truncate">{r.p?.full_name ?? '—'}</span>
                  <span className="text-xs font-semibold text-red-600">{r.n}</span>
                </button>
              )
            })}
            {semResp > 0 && (
              <button onClick={() => setPerson(person === 'none' ? null : 'none')}
                className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1.5 transition', person === 'none' ? 'border-orange-300 bg-orange-50' : 'border-gray-200 hover:bg-gray-50')}>
                <UserX className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-xs text-gray-700">Sem responsável</span>
                <span className="text-xs font-semibold text-amber-600">{semResp}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {person && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5">
          <span className="text-sm text-orange-800">Recortando por <strong>{selName}</strong> — {atr.length} atrasada(s), {par.length} parada(s).</span>
          <Link href={href({ overdue: true })} className="inline-flex items-center gap-1 text-xs font-medium text-orange-700 hover:text-orange-900 shrink-0">Abrir na Lista <ExternalLink className="w-3 h-3" /></Link>
        </div>
      )}

      {/* Onde: etapa, cliente, severidade, paradas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Panel title="Atrasadas por etapa" hint="onde a pauta perde prazo">
          <Bars rows={etapaRows.map(r => ({ label: r.cfg.label, n: r.n, bg: r.cfg.bg, fg: r.cfg.text, href: href({ status: r.cfg.value, overdue: true }) }))} empty="Nada atrasado nesse recorte." />
        </Panel>
        <Panel title="Atrasadas por cliente" hint="qual conta escorrega">
          <Bars rows={cliRows.map(r => ({ label: r.name, n: r.n, bg: '#f97316', fg: '#fff', href: href({ ws: r.ws_id, overdue: true }) }))} empty="Nada atrasado nesse recorte." />
        </Panel>
        <Panel title="Severidade do atraso" hint="o quão grave">
          <div className="grid grid-cols-4 gap-2">
            {([['1–3 dias', sev.s1, '#fca5a5'], ['4–7 dias', sev.s2, '#f87171'], ['8–30 dias', sev.s3, '#ef4444'], ['+30 dias', sev.s4, '#b91c1c']] as const).map(([lab, n, col]) => (
              <div key={lab} className="rounded-xl border border-gray-100 px-2 py-3 text-center">
                <p className="text-2xl font-semibold" style={{ color: n > 0 ? col : '#d1d5db' }}>{n}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{lab}</p>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Paradas por etapa" hint="onde emperra (sem movimento +7d)">
          <Bars rows={paradasRows.map(r => ({ label: r.cfg.label, n: r.n, bg: r.cfg.bg, fg: r.cfg.text, href: href({ status: r.cfg.value }) }))} empty="Nada parado nesse recorte." />
        </Panel>
      </div>

      {/* Carga total + funil (contexto) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Panel title="Carga por pessoa" hint="quem está sobrecarregado (tarefas ativas)">
          <Bars rows={gestao.carga.map(c => ({ label: c.full_name ?? '—', n: c.ativas, bg: '#f97316', fg: '#fff', suffix: Number(c.horas) > 0 ? fmtHoras(c.horas) : undefined }))} empty="Ninguém com atividade ativa." />
        </Panel>
        <Panel title="Funil por status" hint="distribuição da pauta ativa">
          <Bars rows={funilOrdered.map(({ cfg, row }) => ({ label: cfg.label, n: row.n, bg: cfg.bg, fg: cfg.text, href: href({ status: cfg.value }) }))} empty="Sem atividades." />
        </Panel>
      </div>
    </div>
  )
}

function Kpi({ label, n, icon: Icon, tone, href, onClick, active }: {
  label: string; n: number; icon: typeof AlertTriangle; tone: string; href?: string; onClick?: () => void; active?: boolean
}) {
  const toneCls: Record<string, string> = { red: 'text-red-600', amber: 'text-amber-600', orange: 'text-orange-600', gray: 'text-gray-500' }
  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-gray-400">{label}</span>
        <Icon className={cn('w-4 h-4', toneCls[tone])} />
      </div>
      <p className={cn('text-2xl font-semibold mt-1', n > 0 ? toneCls[tone] : 'text-gray-300')}>{n}</p>
    </>
  )
  const cls = cn('block text-left rounded-xl border bg-white px-4 py-3 transition-colors',
    active ? 'border-orange-300 ring-2 ring-orange-200' : 'border-gray-200', (href || onClick) && 'hover:border-gray-300 active:scale-[0.99]')
  if (href) return <Link href={href} className={cls}>{inner}</Link>
  if (onClick) return <button type="button" onClick={onClick} className={cn(cls, 'w-full')}>{inner}</button>
  return <div className={cn(cls, 'cursor-default')}>{inner}</div>
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</h3>
      {hint && <p className="text-[11px] text-gray-400 mb-4 mt-0.5">{hint}</p>}
      <div className={hint ? '' : 'mt-4'}>{children}</div>
    </div>
  )
}

interface BarRowData { label: string; n: number; bg: string; fg: string; href?: string; suffix?: string; text?: string }
function Bars({ rows, empty }: { rows: BarRowData[]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-gray-400">{empty}</p>
  const max = Math.max(1, ...rows.map(r => r.n))
  return (
    <div className="space-y-2">
      {rows.map((r, i) => {
        const bar = (
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-600 w-36 shrink-0 truncate" title={r.label}>{r.label}</span>
            <div className="flex-1 h-5 rounded-md bg-gray-50 overflow-hidden">
              <div className="h-full rounded-md flex items-center justify-end px-2 gap-1" style={{ width: `${Math.max((r.n / max) * 100, 8)}%`, backgroundColor: r.bg }}>
                <span className="text-[11px] font-semibold whitespace-nowrap" style={{ color: r.fg }}>{r.text ?? r.n}</span>
              </div>
            </div>
            {r.suffix && <span className="text-[11px] text-gray-400 shrink-0 w-10 text-right">{r.suffix}</span>}
          </div>
        )
        return r.href
          ? <Link key={i} href={r.href} className="block hover:opacity-90 transition-opacity">{bar}</Link>
          : <div key={i}>{bar}</div>
      })}
    </div>
  )
}

function countBy(rows: ProblemTask[], key: (t: ProblemTask) => string) {
  const m = new Map<string, number>()
  for (const t of rows) m.set(key(t), (m.get(key(t)) ?? 0) + 1)
  return m
}

// ── Financeiro (macro do mês: fluxo, o que acelerar, despesas) ───────────────
const TIPO_MIDIA: Record<string, string> = { impressa_jornal: 'Impressa (jornal)', impressa_revista: 'Impressa (revista)', eletronica: 'Eletrônica', externa: 'Externa', digital: 'Digital', outros: 'Outros' }

function Financeiro({ orgSlug, fin }: { orgSlug: string; fin: FinanceiroData | null }) {
  if (!fin) return <p className="text-sm text-gray-400">Sem dados.</p>

  const resultado = Number(fin.recebido) - Number(fin.pago)
  const margem = Number(fin.recebido) > 0 ? (resultado / Number(fin.recebido)) * 100 : 0

  // ── DRE mensal pela estrutura contábil (DRE_TEMPLATE) ──
  const meses = fin.dre_meses
  const realMap = catMesMap(fin.dre_real)
  const prevMap = catMesMap(fin.dre_prev)
  const gv = (map: Map<string, Map<string, number>>, cat: string, m: string) => map.get(cat)?.get(m) ?? 0
  const folhasDe = (pred: (l: Extract<DreLine, { kind: 'folha' }>) => boolean) =>
    DRE_TEMPLATE.filter((l): l is Extract<DreLine, { kind: 'folha' }> => l.kind === 'folha' && pred(l))

  // Percorre o template acumulando as folhas; totais (NNT) = soma corrida.
  const accR: Record<string, number> = {}, accP: Record<string, number> = {}
  for (const m of meses) { accR[m] = 0; accP[m] = 0 }
  const linhas: { line: DreLine; vr: Record<string, number>; vp: Record<string, number> }[] = []
  for (const line of DRE_TEMPLATE) {
    const vr: Record<string, number> = {}, vp: Record<string, number> = {}
    if (line.kind === 'folha') {
      for (const m of meses) { vr[m] = gv(realMap, line.categoria, m); vp[m] = gv(prevMap, line.categoria, m); accR[m] += vr[m]; accP[m] += vp[m] }
    } else if (line.kind === 'grupo') {
      const fs = folhasDe(l => l.grupo === line.code)
      for (const m of meses) { vr[m] = fs.reduce((s, l) => s + gv(realMap, l.categoria, m), 0); vp[m] = fs.reduce((s, l) => s + gv(prevMap, l.categoria, m), 0) }
    } else if (line.kind === 'sub') {
      const fs = folhasDe(l => l.sub === line.code)
      for (const m of meses) { vr[m] = fs.reduce((s, l) => s + gv(realMap, l.categoria, m), 0); vp[m] = fs.reduce((s, l) => s + gv(prevMap, l.categoria, m), 0) }
    } else {
      for (const m of meses) { vr[m] = accR[m]; vp[m] = accP[m] }
    }
    linhas.push({ line, vr, vp })
  }
  const visivel = linhas.filter(r =>
    r.line.kind === 'grupo' || r.line.kind === 'total' || meses.some(m => r.vr[m] !== 0 || r.vp[m] !== 0))

  const lbl = (l: DreLine) => l.kind === 'folha' ? l.categoria : l.kind === 'total' ? l.label : `${l.code} ${l.label}`
  const mesArquivo = fin.mes
  function exportarCsv() {
    const numBR = (n: number) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })
    const head = ['Linha', ...meses.flatMap(m => [`${monthLabel(m)} real`, `${monthLabel(m)} prev`])]
    const body = visivel.map(({ line, vr, vp }) => [lbl(line), ...meses.flatMap(m => [numBR(vr[m]), numBR(vp[m])])])
    const csv = [head, ...body].map(r => r.join(';')).join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `dre-${mesArquivo}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* Fluxo do mês */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <FinKpi label="A receber (mês)" value={fin.a_receber} tone="emerald" href={`/${orgSlug}/financeiro/fluxo-caixa`}
          hint={Number(fin.a_receber_atrasado) > 0 ? `${formatBRL(fin.a_receber_atrasado)} atrasado` : undefined} />
        <FinKpi label="A pagar (mês)" value={fin.a_pagar} tone="red" href={`/${orgSlug}/financeiro/fluxo-caixa`}
          hint={Number(fin.a_pagar_atrasado) > 0 ? `${formatBRL(fin.a_pagar_atrasado)} atrasado` : undefined} />
        <FinKpi label="Recebido (mês)" value={fin.recebido} tone="emerald" hint={`pago ${formatBRL(fin.pago)}`} />
        <FinKpi label="Resultado (mês)" value={resultado} tone={resultado >= 0 ? 'gray' : 'red'} hint={`margem ${margem.toFixed(0)}%`} />
      </div>

      {/* Acelerar receita */}
      <Panel title="A faturar — acelerar receita" hint="aprovado esperando fatura + pendências de aprovação">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
          <FinMini label="Produção a faturar" n={fin.producao_faturar.n} total={fin.producao_faturar.total} href={`/${orgSlug}/financeiro/faturamento`} strong />
          <FinMini label="Produção p/ aprovar" n={fin.producao_pendente.n} total={fin.producao_pendente.total} href={`/${orgSlug}/producao/orcamento`} />
          <FinMini label="Mídia a liberar" n={fin.midia_pendente.n} total={fin.midia_pendente.total} href={`/${orgSlug}/midias/simplificada`} />
        </div>
        {fin.midia_por_tipo.length > 0 && <>
          <p className="text-[11px] text-gray-400 mb-1.5">Mídia pendente por tipo (valor bruto)</p>
          <Bars empty="—" rows={fin.midia_por_tipo.map(t => ({ label: TIPO_MIDIA[t.tipo] ?? t.tipo, n: Number(t.total), bg: '#f97316', fg: '#fff', text: formatBRL(t.total), suffix: `${t.n} un` }))} />
        </>}
      </Panel>

      {/* DRE mensal (estrutura contábil) */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <div className="flex items-center justify-between gap-2 mb-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">DRE mensal</h3>
          <button onClick={exportarCsv} className="inline-flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-700"><Download className="w-3.5 h-3.5" /> CSV</button>
        </div>
        <p className="text-[11px] text-gray-400 mb-4">Realizado (topo) × previsto (cinza), em milhares (k). Últimos 6 meses.</p>
        {meses.length === 0 ? <p className="text-sm text-gray-400">Sem dados no período.</p> : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full min-w-[680px] text-sm border-collapse">
              <thead>
                <tr className="text-[11px] text-gray-400">
                  <th className="text-left font-medium py-1.5 px-2 sticky left-0 bg-white">Linha</th>
                  {meses.map(m => <th key={m} className="text-right font-medium py-1.5 px-2 whitespace-nowrap">{monthLabel(m)}</th>)}
                </tr>
              </thead>
              <tbody>
                {visivel.map(({ line, vr, vp }, i) => {
                  const isTotal = line.kind === 'total', isGrupo = line.kind === 'grupo', isSub = line.kind === 'sub'
                  const strong = isTotal || isGrupo
                  return (
                    <tr key={i} className={cn('border-t', isTotal ? 'border-gray-300' : 'border-gray-50', isGrupo && 'bg-gray-50/60')}>
                      <td className={cn('text-left py-1.5 px-2 sticky left-0 bg-white truncate max-w-[220px]',
                        isSub && 'pl-5 text-gray-500 text-[13px]', line.kind === 'folha' && 'pl-7 text-gray-600',
                        strong ? 'font-semibold text-gray-800' : '')} title={lbl(line)}>{lbl(line)}</td>
                      {meses.map(m => {
                        const r = vr[m], p = vp[m]
                        const color = line.kind === 'total' ? (r >= 0 ? 'text-gray-900' : 'text-red-600') : r < 0 ? 'text-red-600' : 'text-gray-700'
                        return (
                          <td key={m} className="text-right py-1.5 px-2 tabular-nums whitespace-nowrap">
                            <span className={cn(strong && 'font-semibold', color)}>{r ? fmtK(r) : '·'}</span>
                            {p !== 0 && <span className="block text-[10px] text-gray-300 leading-tight">{fmtK(p)}</span>}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function catMesMap(rows: CatMesV[]) {
  const m = new Map<string, Map<string, number>>()
  for (const r of rows) {
    if (!m.has(r.categoria)) m.set(r.categoria, new Map())
    const inner = m.get(r.categoria)!
    inner.set(r.mes, (inner.get(r.mes) ?? 0) + Number(r.v))
  }
  return m
}
function fmtK(n: number) {
  const a = Math.abs(n)
  if (a >= 1000) return (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k'
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
}

function FinKpi({ label, value, tone, hint, href }: { label: string; value: number | string; tone: string; hint?: string; href?: string }) {
  const n = Number(value)
  const color = tone === 'emerald' ? 'text-emerald-600' : tone === 'red' ? 'text-red-600' : n >= 0 ? 'text-gray-900' : 'text-red-600'
  const inner = (
    <>
      <p className="text-[11px] font-medium text-gray-400">{label}</p>
      <p className={cn('text-xl font-semibold mt-1', color)}>{formatBRL(n)}</p>
      {hint && <p className="text-[10px] text-gray-400 mt-0.5">{hint}</p>}
    </>
  )
  const cls = 'block rounded-xl border border-gray-200 bg-white px-4 py-3'
  return href ? <Link href={href} className={cn(cls, 'hover:border-gray-300 transition')}>{inner}</Link> : <div className={cls}>{inner}</div>
}

function FinMini({ label, n, total, href, strong }: { label: string; n: number; total: number | string; href?: string; strong?: boolean }) {
  const inner = (
    <>
      <p className="text-[11px] text-gray-400 leading-tight">{label}</p>
      <p className={cn('text-base font-semibold mt-0.5', strong ? 'text-orange-600' : 'text-gray-900')}>{formatBRL(Number(total))}</p>
      <p className="text-[10px] text-gray-400">{n} {n === 1 ? 'item' : 'itens'}</p>
    </>
  )
  const cls = cn('block rounded-xl border px-3 py-2.5', strong ? 'border-orange-200 bg-orange-50/40' : 'border-gray-100')
  return href ? <Link href={href} className={cn(cls, 'hover:border-gray-300 transition')}>{inner}</Link> : <div className={cls}>{inner}</div>
}

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
function monthLabel(ym: string) { const [y, m] = ym.split('-'); return `${MESES[Number(m) - 1]} ${y}` }
function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
function nowMonth() { return new Date().toISOString().slice(0, 7) }

// ── Engajamento (calendário estilo GitHub por pessoa) ────────────────────────
function Engajamento({ engajamento }: { engajamento: EngajamentoData | null }) {
  const byUser = useMemo(() => {
    const m: Record<string, Record<string, number>> = {}
    for (const d of engajamento?.daily ?? []) {
      (m[d.user_id] ??= {})[d.day] = d.n
    }
    return m
  }, [engajamento])

  if (!engajamento) return <p className="text-sm text-gray-400">Sem dados.</p>
  const weeks = weeksBetween(engajamento.since, engajamento.until)

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-400">Interação = mudar status, editar campo, comentar ou reagir. Ranking pelo total no período.</p>

      {engajamento.users.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">Nenhuma interação no período.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {engajamento.users.map((u, i) => (
            <div key={u.user_id} className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center gap-2.5 mb-3">
                <span className="text-xs font-semibold text-gray-300 w-4 shrink-0 text-center">{i + 1}</span>
                <Avatar name={u.full_name} avatarUrl={u.avatar_url} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{u.full_name ?? '—'}</p>
                  <p className="text-[11px] text-gray-400 truncate">
                    {Object.entries(u.por_tipo).map(([k, n]) => `${n} ${KIND_LABEL[k] ?? k}`).join(' · ') || 'sem detalhe'}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-semibold text-orange-600 leading-none flex items-center gap-1 justify-end"><ActivityIcon className="w-4 h-4" />{u.total}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">interações</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <div className="flex gap-1 w-max">
                  {weeks.map((col, ci) => (
                    <div key={ci} className="flex flex-col gap-1">
                      {col.map((day, ri) => {
                        const n = day ? (byUser[u.user_id]?.[day] ?? 0) : -1
                        return <div key={ri} title={day ? `${n} em ${formatBR(day)}` : ''}
                          className={cn('w-3 h-3 rounded-sm', day ? CELL[level(n)] : 'bg-transparent')} />
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── helpers ──────────────────────────────────────────────────────────────────
// Aceita 'YYYY-MM-DD' ou timestamp ISO ('YYYY-MM-DDT…') — usa só a parte da data.
function formatBR(iso: string) { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}` }
function fmtHoras(h: number | string) { const n = Number(h); return `${Number.isInteger(n) ? n : n.toFixed(1)}h` }
function level(n: number) { if (n <= 0) return 0; if (n <= 2) return 1; if (n <= 5) return 2; if (n <= 10) return 3; return 4 }
const CELL = [
  'bg-gray-100 dark:bg-gray-800',
  'bg-orange-200 dark:bg-orange-900/60',
  'bg-orange-300 dark:bg-orange-700',
  'bg-orange-400 dark:bg-orange-500',
  'bg-orange-600 dark:bg-orange-400',
]
function toUTC(s: string) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
function ymd(dt: Date) { return dt.toISOString().slice(0, 10) }
/** Colunas = semanas (domingo→sábado); dias fora do intervalo viram null. */
function weeksBetween(since: string, until: string): (string | null)[][] {
  const start = toUTC(since), end = toUTC(until)
  const cur = new Date(start)
  cur.setUTCDate(cur.getUTCDate() - cur.getUTCDay())  // alinha ao domingo
  const weeks: (string | null)[][] = []
  while (cur <= end) {
    const col: (string | null)[] = []
    for (let i = 0; i < 7; i++) {
      col.push(cur >= start && cur <= end ? ymd(cur) : null)
      cur.setUTCDate(cur.getUTCDate() + 1)
    }
    weeks.push(col)
  }
  return weeks
}
