'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import { MultiSelect, Select } from '@/components/ui/Select'
import { useStatusConfig } from '@/components/ui/StatusBadge'
import { AlertTriangle, UserX, CalendarOff, PauseCircle, ChevronRight, Loader2, Activity as ActivityIcon } from 'lucide-react'

export interface GestaoItem {
  id: string; title: string; ws_id: string; campaign_id: string
  ws_name: string; camp_name: string; due_date?: string; status?: string; dias?: number
}
export interface CargaRow { user_id: string; full_name: string | null; avatar_url: string | null; ativas: number; horas: number }
export interface FunilRow { status: string; n: number }
export interface GestaoData {
  total_ativas: number
  n_atrasadas: number; n_sem_responsavel: number; n_sem_prazo: number; n_paradas: number
  atrasadas: GestaoItem[]; sem_responsavel: GestaoItem[]; paradas: GestaoItem[]
  carga: CargaRow[]; funil: FunilRow[]
}
export interface EngUser { user_id: string; full_name: string | null; avatar_url: string | null; total: number; por_tipo: Record<string, number> }
export interface EngDaily { user_id: string; day: string; n: number }
export interface EngajamentoData { since: string; until: string; days: number; users: EngUser[]; daily: EngDaily[] }

const DIAS_OPTIONS = [
  { value: '28', label: '4 semanas' },
  { value: '84', label: '12 semanas' },
  { value: '182', label: '6 meses' },
  { value: '364', label: '1 ano' },
]
const KIND_LABEL: Record<string, string> = { status: 'status', campo: 'campos', comentario: 'comentários', reacao: 'reações' }

export function GestaoClient({
  orgSlug, workspaces, wsFilter, dias, aba: abaInicial, gestao, engajamento,
}: {
  orgSlug: string
  workspaces: { id: string; name: string }[]
  wsFilter: string[]
  dias: number
  aba: 'operacao' | 'engajamento'
  gestao: GestaoData | null
  engajamento: EngajamentoData | null
}) {
  const router = useRouter()
  const [aba, setAba] = useState(abaInicial)
  const [pending, start] = useTransition()

  function pushParams(patch: { ws?: string[]; dias?: number }) {
    const ws = patch.ws ?? wsFilter
    const d = patch.dias ?? dias
    const params = new URLSearchParams()
    if (ws.length) params.set('ws', ws.join(','))
    if (d !== 84) params.set('dias', String(d))
    start(() => router.push(`/${orgSlug}/views/gestao${params.toString() ? `?${params}` : ''}`))
  }

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Gestão</h1>
          <p className="text-gray-500 text-sm mt-0.5">Visão da operação e do engajamento do time — só para gestores.</p>
        </div>
        {pending && <Loader2 className="w-4 h-4 text-gray-300 animate-spin mt-1" />}
      </div>

      {/* Abas */}
      <div className="inline-flex bg-gray-100 rounded-xl p-0.5 mb-5">
        {([['operacao', 'Operação'], ['engajamento', 'Engajamento']] as const).map(([v, label]) => (
          <button key={v} onClick={() => setAba(v)} aria-pressed={aba === v}
            className={cn('px-3.5 py-1.5 text-sm font-medium rounded-[10px] transition-colors',
              aba === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
            {label}
          </button>
        ))}
      </div>

      {aba === 'operacao'
        ? <Operacao orgSlug={orgSlug} workspaces={workspaces} wsFilter={wsFilter} gestao={gestao}
            onWs={ws => pushParams({ ws })} />
        : <Engajamento dias={dias} engajamento={engajamento} onDias={d => pushParams({ dias: d })} />}
    </div>
  )
}

// ── Operação (3.1) ──────────────────────────────────────────────────────────
function Operacao({ orgSlug, workspaces, wsFilter, gestao, onWs }: {
  orgSlug: string; workspaces: { id: string; name: string }[]; wsFilter: string[]
  gestao: GestaoData | null; onWs: (ws: string[]) => void
}) {
  const statusConfig = useStatusConfig()
  const [open, setOpen] = useState<'atrasadas' | 'sem_responsavel' | 'paradas' | null>('atrasadas')
  if (!gestao) return <p className="text-sm text-gray-400">Sem dados.</p>

  const cards = [
    { key: 'atrasadas' as const, label: 'Atrasadas', n: gestao.n_atrasadas, icon: AlertTriangle, tone: 'red', items: gestao.atrasadas },
    { key: 'sem_responsavel' as const, label: 'Sem responsável', n: gestao.n_sem_responsavel, icon: UserX, tone: 'amber', items: gestao.sem_responsavel },
    { key: 'paradas' as const, label: 'Paradas +7 dias', n: gestao.n_paradas, icon: PauseCircle, tone: 'orange', items: gestao.paradas },
    { key: 'sem_prazo' as const, label: 'Sem prazo', n: gestao.n_sem_prazo, icon: CalendarOff, tone: 'gray', items: null },
  ]
  const toneCls: Record<string, string> = {
    red: 'text-red-600', amber: 'text-amber-600', orange: 'text-orange-600', gray: 'text-gray-500',
  }
  const openCard = cards.find(c => c.key === open && c.items)
  const maxCarga = Math.max(1, ...gestao.carga.map(c => c.ativas))
  const funilOrdered = statusConfig
    .map(s => ({ cfg: s, row: gestao.funil.find(f => f.status === s.value) }))
    .filter(x => x.row) as { cfg: typeof statusConfig[number]; row: FunilRow }[]
  const maxFunil = Math.max(1, ...funilOrdered.map(x => x.row.n))

  return (
    <div className="space-y-6">
      {/* filtro por cliente */}
      <div className="flex items-center gap-2 flex-wrap">
        {workspaces.length > 1 && (
          <MultiSelect values={wsFilter} onChange={onWs} className="w-52" allLabel="Todos os clientes"
            options={workspaces.map(w => ({ value: w.id, label: w.name }))} />
        )}
        <span className="text-sm text-gray-400">{gestao.total_ativas} atividades ativas</span>
      </div>

      {/* cards de alerta */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map(c => {
          const Icon = c.icon
          const clickable = !!c.items
          const active = open === c.key && clickable
          return (
            <button key={c.key} type="button" disabled={!clickable}
              onClick={() => clickable && setOpen(active ? null : c.key)}
              className={cn('text-left rounded-xl border bg-white px-4 py-3 transition-colors',
                active ? 'border-orange-300 ring-2 ring-orange-200' : 'border-gray-200',
                clickable ? 'hover:border-gray-300 active:scale-[0.99]' : 'cursor-default')}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-gray-400">{c.label}</span>
                <Icon className={cn('w-4 h-4', toneCls[c.tone])} />
              </div>
              <p className={cn('text-2xl font-semibold mt-1', c.n > 0 ? toneCls[c.tone] : 'text-gray-300')}>{c.n}</p>
            </button>
          )
        })}
      </div>

      {/* lista do card aberto */}
      {openCard && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 text-xs font-semibold uppercase tracking-wide text-gray-400">
            {openCard.label} · {openCard.items!.length}{openCard.items!.length >= 60 ? '+' : ''}
          </div>
          {openCard.items!.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">Nada aqui. 🎉</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {openCard.items!.map(it => (
                <li key={it.id}>
                  <Link href={`/${orgSlug}/workspaces/${it.ws_id}/campaigns/${it.campaign_id}/activities/${it.id}`}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50/60 transition group">
                    <span className="flex-1 min-w-0">
                      <span className="text-sm text-gray-900 truncate block">{it.title}</span>
                      <span className="text-xs text-gray-400">{it.ws_name} · {it.camp_name}</span>
                    </span>
                    {it.due_date && <span className="text-xs text-red-600 font-medium shrink-0">{formatBR(it.due_date)}</span>}
                    {typeof it.dias === 'number' && <span className="text-xs text-orange-600 font-medium shrink-0">{it.dias}d parada</span>}
                    <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* carga por pessoa + funil */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-4">Carga por pessoa</h3>
          {gestao.carga.length === 0 ? <p className="text-sm text-gray-400">Ninguém com atividade ativa.</p> : (
            <div className="space-y-3">
              {gestao.carga.map(c => (
                <div key={c.user_id} className="flex items-center gap-3">
                  <Avatar name={c.full_name} avatarUrl={c.avatar_url} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-sm text-gray-800 truncate">{c.full_name ?? '—'}</span>
                      <span className="text-xs text-gray-500 shrink-0">{c.ativas} {c.ativas === 1 ? 'tarefa' : 'tarefas'}{Number(c.horas) > 0 ? ` · ${fmtHoras(c.horas)}` : ''}</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full bg-orange-500 rounded-full" style={{ width: `${(c.ativas / maxCarga) * 100}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-4">Funil por status</h3>
          {funilOrdered.length === 0 ? <p className="text-sm text-gray-400">Sem atividades.</p> : (
            <div className="space-y-2">
              {funilOrdered.map(({ cfg, row }) => (
                <div key={cfg.value} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-40 shrink-0 truncate">{cfg.label}</span>
                  <div className="flex-1 h-5 rounded-md bg-gray-50 overflow-hidden">
                    <div className="h-full rounded-md flex items-center justify-end px-2" style={{ width: `${Math.max((row.n / maxFunil) * 100, 8)}%`, backgroundColor: cfg.bg }}>
                      <span className="text-[11px] font-semibold" style={{ color: cfg.text }}>{row.n}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Engajamento (calendário estilo GitHub por pessoa) ────────────────────────
function Engajamento({ dias, engajamento, onDias }: {
  dias: number; engajamento: EngajamentoData | null; onDias: (d: number) => void
}) {
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
      <div className="flex items-center gap-2 flex-wrap">
        <div className="w-40"><Select value={String(dias)} onChange={v => onDias(parseInt(v, 10))} options={DIAS_OPTIONS} /></div>
        <span className="text-sm text-gray-400">Interação = mudar status, editar campo, comentar ou reagir.</span>
      </div>

      {engajamento.users.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">Nenhuma interação no período.</p>
      ) : (
        <div className="space-y-3">
          {engajamento.users.map((u, i) => (
            <div key={u.user_id} className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xs font-semibold text-gray-300 w-5 shrink-0 text-center">{i + 1}</span>
                <Avatar name={u.full_name} avatarUrl={u.avatar_url} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{u.full_name ?? '—'}</p>
                  <p className="text-xs text-gray-400">
                    {Object.entries(u.por_tipo).map(([k, n]) => `${n} ${KIND_LABEL[k] ?? k}`).join(' · ') || 'sem detalhe'}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-semibold text-orange-600 leading-none flex items-center gap-1 justify-end"><ActivityIcon className="w-4 h-4" />{u.total}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">interações</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <div className="flex gap-1">
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
function formatBR(iso: string) { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}` }
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
