import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { getMergedStatusConfig, type StatusOverride } from '@/types'
import {
  AlertCircle, CheckCircle2, Clock, CalendarClock,
  AlertTriangle, ChevronRight, Users, Activity, Timer, Target,
  TrendingUp, TrendingDown, Wallet, ArrowRight,
} from 'lucide-react'
import { cn, formatDate, isOverdue, parseDateLocal } from '@/lib/utils'
import { formatBRL } from '@/lib/midia'
import Link from 'next/link'
import { Avatar } from '@/components/ui/Avatar'
import { WeeklyProgress } from '@/components/dashboard/WeeklyProgress'
import { ConciliacaoAlert } from '@/components/dashboard/ConciliacaoAlert'

interface HomePessoal { concluidas_mes: number; no_prazo_pct: number | null; tempo_medio_dias: number | null; interacoes_30d: number }
interface HomePessoaRank { user_id: string; full_name: string | null; avatar_url: string | null; concluidas: number; no_prazo_pct: number | null; carga: number }
interface HomeEquipe { em_andamento: number; atrasadas: number; concluidas_mes: number; sla_prazo_pct: number | null; funil: { status: string; n: number }[]; pessoas: HomePessoaRank[] }
interface HomeFinanceiro { a_receber: number; a_pagar: number; recebido: number; pago: number; a_receber_atrasado: number; a_pagar_atrasado: number; saldo: number }
interface HomeData { pessoal: HomePessoal; equipe: HomeEquipe | null; financeiro: HomeFinanceiro | null; flags: { pode_time: boolean; pode_financeiro: boolean } }

const pct = (v: number | null) => (v == null ? '—' : `${v}%`)
const pctColor = (v: number | null) =>
  v == null ? 'text-gray-400' : v >= 85 ? 'text-emerald-600' : v >= 60 ? 'text-amber-600' : 'text-red-600'

export default async function DashboardPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const supabase = await createClient()

  const user = await getUsuario()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles').select('full_name').eq('id', user.id).single()
  const { data: orgData } = await supabase
    .from('organizations').select('id, name').eq('slug', orgSlug).single()
  if (!orgData) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawSettings } = await (supabase as any)
    .from('org_settings').select('status_overrides').eq('org_id', orgData.id).single()
  const statusConfig = getMergedStatusConfig((rawSettings?.status_overrides ?? []) as StatusOverride[])

  // ── Camadas gated (pessoal + equipe se owner/admin + financeiro se can_finance) ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: homeRaw } = await (supabase as any)
    .rpc('dashboard_home', { p_user_id: user.id, p_org_id: orgData.id })
  const home = (homeRaw ?? null) as HomeData | null
  const pessoal = home?.pessoal
  const equipe = home?.equipe ?? null
  const financeiro = home?.financeiro ?? null

  // ── Minhas atividades (sou responsável pelo status ATUAL) ─────────────────
  const { data: myAssignments } = await supabase
    .from('activity_status_assignees').select('activity_id, status').eq('user_id', user.id)
  const myActivityIds = [...new Set((myAssignments ?? []).map(a => a.activity_id))]
  const myStatusMap = (myAssignments ?? []).reduce<Record<string, string[]>>((acc, a) => {
    if (!acc[a.activity_id]) acc[a.activity_id] = []
    acc[a.activity_id].push(a.status)
    return acc
  }, {})

  const { data: myActivitiesRaw } = myActivityIds.length
    ? await supabase
        .from('activities')
        .select('id, title, status, due_date, campaign_id, campaigns(id, name, workspace_id, workspaces(id, name))')
        .in('id', myActivityIds).eq('archived', false).neq('status', 'concluido')
    : { data: [] }
  const myActive = (myActivitiesRaw ?? []).filter(a => myStatusMap[a.id]?.includes(a.status))

  // ── Concluídas essa semana (pro hero) ─────────────────────────────────────
  const monday = new Date()
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  monday.setHours(0, 0, 0, 0)
  const { data: doneHistory } = myActivityIds.length
    ? await supabase.from('activity_history').select('activity_id')
        .eq('to_status', 'concluido').gte('changed_at', monday.toISOString()).in('activity_id', myActivityIds)
    : { data: [] }
  const doneThisWeek = new Set((doneHistory ?? []).map(h => h.activity_id)).size

  // ── Buckets de prazo (local + prazo 19h; ver lib/utils) ────────────────────
  const now0 = new Date(); now0.setHours(0, 0, 0, 0)
  const weekEnd = new Date(now0); weekEnd.setDate(now0.getDate() + 7)
  const dueLocal = (dd: string | null) => parseDateLocal(dd)

  const overdueTasks = myActive.filter(a => isOverdue(a.due_date))
  const todayTasks = myActive.filter(a => {
    const d = dueLocal(a.due_date)
    return !!d && !isOverdue(a.due_date) && d.getTime() === now0.getTime()
  })
  const weekTasks = myActive.filter(a => {
    const d = dueLocal(a.due_date)
    return !!d && d.getTime() > now0.getTime() && d < weekEnd
  })
  const laterTasks = myActive.filter(a => { const d = dueLocal(a.due_date); return !d || d >= weekEnd })
  const totalWeek = doneThisWeek + myActive.filter(a => { const d = dueLocal(a.due_date); return !!d && d < weekEnd }).length

  // ── Movimentações das MINHAS tarefas (pessoal — todos veem só o próprio) ────
  const { data: history } = myActivityIds.length
    ? await supabase.from('activity_history')
        .select('id, to_status, changed_at, activities(id, title, campaign_id, campaigns(workspace_id)), profiles(full_name, avatar_url)')
        .in('activity_id', myActivityIds.slice(0, 200))
        .order('changed_at', { ascending: false }).limit(8)
    : { data: [] }

  const userName = profile?.full_name ?? user.email ?? 'você'

  const meuDesempenho = [
    { label: 'Concluídas no mês', value: String(pessoal?.concluidas_mes ?? 0), icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Entregues no prazo', value: pct(pessoal?.no_prazo_pct ?? null), icon: Target, color: pctColor(pessoal?.no_prazo_pct ?? null), bg: 'bg-blue-50' },
    { label: 'Tempo médio', value: pessoal?.tempo_medio_dias != null ? `${pessoal.tempo_medio_dias}d` : '—', icon: Timer, color: 'text-gray-700', bg: 'bg-gray-100' },
    { label: 'Interações (30d)', value: String(pessoal?.interacoes_30d ?? 0), icon: Activity, color: 'text-orange-600', bg: 'bg-orange-50' },
  ]

  return (
    <div className="p-6">
      <WeeklyProgress done={doneThisWeek} total={Math.max(totalWeek, doneThisWeek)}
        overdue={overdueTasks.length} myActiveCount={myActive.length} userName={userName} />

      <ConciliacaoAlert orgSlug={orgSlug} orgId={orgData.id} userId={user.id} />

      {/* ── Meu dia ────────────────────────────────────────────────────────── */}
      <SectionTitle icon={Clock}>Meu dia</SectionTitle>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Minhas ativas', value: myActive.length, icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Atrasadas', value: overdueTasks.length, icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50' },
          { label: 'Vencem hoje', value: todayTasks.length, icon: AlertTriangle, color: 'text-orange-600', bg: 'bg-orange-50' },
          { label: 'Vencem essa semana', value: weekTasks.length, icon: CalendarClock, color: 'text-yellow-600', bg: 'bg-yellow-50' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <StatCard key={label} label={label} value={value} Icon={Icon} color={color} bg={bg} />
        ))}
      </div>

      {/* ── Meu desempenho (só o próprio) ─────────────────────────────────────── */}
      <SectionTitle icon={TrendingUp} hint="só o seu — nunca dos colegas">Meu desempenho</SectionTitle>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {meuDesempenho.map(({ label, value, icon: Icon, color, bg }) => (
          <StatCard key={label} label={label} value={value} Icon={Icon} color={color} bg={bg} />
        ))}
      </div>

      {myActive.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Minhas tarefas</h2>
          <div className="space-y-1">
            {[
              { tasks: overdueTasks, label: 'Atrasadas', dot: 'bg-red-500', badge: 'bg-red-50 text-red-600' },
              { tasks: todayTasks, label: 'Vencem hoje', dot: 'bg-orange-400', badge: 'bg-orange-50 text-orange-600' },
              { tasks: weekTasks, label: 'Esta semana', dot: 'bg-yellow-400', badge: 'bg-yellow-50 text-yellow-600' },
              { tasks: laterTasks, label: 'Mais adiante', dot: 'bg-gray-300', badge: 'bg-gray-50 text-gray-500' },
            ].map(({ tasks, label, dot, badge }) =>
              tasks.length > 0 && (
                <div key={label}>
                  <div className="flex items-center gap-2 px-2 py-1.5 mb-1">
                    <span className={cn('w-2 h-2 rounded-full shrink-0', dot)} />
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</span>
                  </div>
                  {tasks.map(task => {
                    const ws = (task.campaigns as unknown as { name: string; workspaces: { id: string; name: string } | null } | null)
                    const wsId = ws?.workspaces?.id
                    const statusCfg = statusConfig.find(s => s.value === task.status)
                    return (
                      <Link key={task.id}
                        href={`/${orgSlug}/workspaces/${wsId}/campaigns/${task.campaign_id}/activities/${task.id}?from=${encodeURIComponent(`/${orgSlug}/dashboard`)}`}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 transition group">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{task.title}</p>
                          <p className="text-xs text-gray-400 truncate mt-0.5">{ws?.workspaces?.name ?? ws?.name} {ws?.name ? `· ${ws.name}` : ''}</p>
                        </div>
                        {statusCfg && (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full shrink-0"
                            style={{ backgroundColor: statusCfg.bg, color: statusCfg.text }}>{statusCfg.label}</span>
                        )}
                        {task.due_date && (
                          <span className={cn('text-xs font-medium shrink-0 px-2 py-0.5 rounded-full', badge)}>{formatDate(task.due_date)}</span>
                        )}
                        <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500 shrink-0 transition" />
                      </Link>
                    )
                  })}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Movimentações das minhas tarefas */}
      {(history?.length ?? 0) > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Movimentações das minhas tarefas</h2>
          <div className="space-y-3">
            {(history ?? []).map(h => {
              const activity = h.activities as unknown as { id: string; title: string; campaign_id: string; campaigns: { workspace_id: string } | null } | null
              const prof = h.profiles as unknown as { full_name: string | null; avatar_url: string | null } | null
              const statusCfg = statusConfig.find(s => s.value === h.to_status)
              const wsId = activity?.campaigns?.workspace_id
              return (
                <div key={h.id} className="flex items-start gap-2.5">
                  <Avatar name={prof?.full_name ?? '?'} avatarUrl={prof?.avatar_url} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-medium text-gray-700 truncate">{prof?.full_name ?? 'Alguém'}</span>
                      <span className="text-xs text-gray-400">moveu para</span>
                      {statusCfg && (
                        <span className="text-xs font-medium px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: statusCfg.bg, color: statusCfg.text }}>{statusCfg.label}</span>
                      )}
                    </div>
                    {activity && wsId && (
                      <Link href={`/${orgSlug}/workspaces/${wsId}/campaigns/${activity.campaign_id}/activities/${activity.id}?from=${encodeURIComponent(`/${orgSlug}/dashboard`)}`}
                        className="text-xs text-gray-500 hover:text-orange-600 transition truncate block mt-0.5">{activity.title}</Link>
                    )}
                  </div>
                  <span className="text-[10px] text-gray-400 shrink-0 mt-0.5">
                    {new Date(h.changed_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Time (owner/admin) ─────────────────────────────────────────────── */}
      {equipe && (
        <>
          <SectionTitle icon={Users} hint="dados do time" locked
            action={<Link href={`/${orgSlug}/views/gestao`} className="text-xs font-medium text-orange-600 hover:text-orange-700 inline-flex items-center gap-1">Ver Gestão completa <ArrowRight className="w-3.5 h-3.5" /></Link>}>
            Time
          </SectionTitle>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <StatCard label="Em andamento" value={equipe.em_andamento} Icon={Clock} color="text-blue-600" bg="bg-blue-50" />
            <StatCard label="Atrasadas" value={equipe.atrasadas} Icon={AlertCircle} color="text-red-600" bg="bg-red-50" />
            <StatCard label="Concluídas no mês" value={equipe.concluidas_mes} Icon={CheckCircle2} color="text-emerald-600" bg="bg-emerald-50" />
            <StatCard label="SLA no prazo" value={pct(equipe.sla_prazo_pct)} Icon={Target} color={pctColor(equipe.sla_prazo_pct)} bg="bg-orange-50" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Funil por status */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Atividades por status</h2>
              <div className="space-y-2.5">
                {statusConfig.map(s => {
                  const n = equipe.funil.find(f => f.status === s.value)?.n ?? 0
                  if (!n) return null
                  return (
                    <div key={s.value} className="flex items-center gap-3">
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0 w-40 truncate"
                        style={{ backgroundColor: s.bg, color: s.text }}>{s.label}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full"
                          style={{ width: `${(n / Math.max(equipe.em_andamento, 1)) * 100}%`, backgroundColor: s.text }} />
                      </div>
                      <span className="text-sm font-medium text-gray-600 w-6 text-right shrink-0">{n}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Ranking de desempenho por pessoa */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Desempenho por pessoa</h2>
              {equipe.pessoas.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">Sem dados no período.</p>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-3 px-1 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                    <span className="flex-1">Pessoa</span>
                    <span className="w-16 text-right">Concl.</span>
                    <span className="w-16 text-right">No prazo</span>
                    <span className="w-12 text-right">Carga</span>
                  </div>
                  {equipe.pessoas.map(p => (
                    <div key={p.user_id} className="flex items-center gap-3">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <Avatar name={p.full_name ?? '?'} avatarUrl={p.avatar_url} size="sm" />
                        <span className="text-sm text-gray-700 truncate">{p.full_name ?? 'Sem nome'}</span>
                      </div>
                      <span className="w-16 text-right text-sm font-medium text-gray-700 tabular-nums">{p.concluidas}</span>
                      <span className={cn('w-16 text-right text-sm font-medium tabular-nums', pctColor(p.no_prazo_pct))}>{pct(p.no_prazo_pct)}</span>
                      <span className="w-12 text-right text-sm text-gray-500 tabular-nums">{p.carga}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Financeiro (can_finance) ───────────────────────────────────────── */}
      {financeiro && (
        <>
          <SectionTitle icon={Wallet} hint="visão do mês" locked
            action={<Link href={`/${orgSlug}/financeiro/painel`} className="text-xs font-medium text-orange-600 hover:text-orange-700 inline-flex items-center gap-1">Abrir Financeiro <ArrowRight className="w-3.5 h-3.5" /></Link>}>
            Financeiro
          </SectionTitle>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <FinCard label="A receber no mês" value={financeiro.a_receber} sub={financeiro.a_receber_atrasado > 0 ? `${formatBRL(financeiro.a_receber_atrasado)} atrasado` : undefined}
              Icon={TrendingUp} color="text-emerald-600" bg="bg-emerald-50" />
            <FinCard label="A pagar no mês" value={financeiro.a_pagar} sub={financeiro.a_pagar_atrasado > 0 ? `${formatBRL(financeiro.a_pagar_atrasado)} atrasado` : undefined}
              Icon={TrendingDown} color="text-red-600" bg="bg-red-50" />
            <FinCard label="Recebido no mês" value={financeiro.recebido} Icon={CheckCircle2} color="text-emerald-600" bg="bg-emerald-50" />
            <FinCard label="Saldo em conta" value={financeiro.saldo} Icon={Wallet} color={financeiro.saldo >= 0 ? 'text-gray-800' : 'text-red-600'} bg="bg-gray-100" />
          </div>
        </>
      )}
    </div>
  )
}

function SectionTitle({ icon: Icon, children, hint, locked, action }: {
  icon: React.ComponentType<{ className?: string }>; children: React.ReactNode
  hint?: string; locked?: boolean; action?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon className="w-4 h-4 text-gray-400" />
      <h2 className="text-sm font-semibold text-gray-700">{children}</h2>
      {locked && <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">restrito</span>}
      {hint && <span className="text-xs text-gray-400">{hint}</span>}
      {action && <span className="ml-auto">{action}</span>}
    </div>
  )
}

function StatCard({ label, value, Icon, color, bg }: {
  label: string; value: string | number; Icon: React.ComponentType<{ className?: string }>; color: string; bg: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className={cn('inline-flex p-2 rounded-lg mb-3', bg)}><Icon className={cn('w-5 h-5', color)} /></div>
      <div className="text-3xl font-bold text-gray-900">{value}</div>
      <div className="text-sm text-gray-500 mt-1">{label}</div>
    </div>
  )
}

function FinCard({ label, value, sub, Icon, color, bg }: {
  label: string; value: number; sub?: string; Icon: React.ComponentType<{ className?: string }>; color: string; bg: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className={cn('inline-flex p-2 rounded-lg mb-3', bg)}><Icon className={cn('w-5 h-5', color)} /></div>
      <div className={cn('text-2xl font-bold tabular-nums', color)}>{formatBRL(value)}</div>
      <div className="text-sm text-gray-500 mt-1">{label}</div>
      {sub && <div className="text-xs text-red-500 mt-0.5">{sub}</div>}
    </div>
  )
}
