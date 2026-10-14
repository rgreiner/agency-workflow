import Link from 'next/link'
import { redirect } from 'next/navigation'
import { sessaoPortal, portalTemSenha } from '@/lib/auth/portal'
import { createPortalClient } from '@/lib/supabase/portal'
import { sairPortal } from '@/app/actions/portal'
import { AutoRefresh } from '@/components/ui/AutoRefresh'
import {
  LogOut, Plus, ArrowRight, NotebookPen, CalendarDays, CheckCircle2, Layers, Receipt,
} from 'lucide-react'
import { dataBR } from '@/lib/reunioes'
import { PortalThemeToggle } from '../PortalThemeToggle'
import { SenhaPortalButton } from './SenhaPortalButton'
import { PortalNav } from '../PortalNav'
import { FlowMark } from '@/components/brand/FlowMark'

export const dynamic = 'force-dynamic'

interface PortalTarefa {
  id: string
  titulo: string
  campanha: string
  coluna: 'pendente' | 'agencia' | 'aprovacao'
  /** Fase legível (Planejamento, Criação, Produção…) — o status interno não sai do banco. */
  fase: string
  prazo: string | null
  /** Desde quando está no status atual. */
  desde: string | null
  /** 'aprovacao' | 'ajuste' | null — o que o cliente já respondeu nesta rodada. */
  decidido?: string | null
  respondido?: boolean | null
}

interface PortalOrcamentoResumo {
  id: string; titulo: string; numero: number | null; serie: string | null
  valor: number; estado: 'aguardando' | 'ajuste' | 'aprovado'
}

interface PortalDashboard {
  usuario: { nome: string; email: string }
  preview: boolean
  agencia: string | null
  cliente: { nome: string } | null
  tarefas: PortalTarefa[]
  entregues: { id: string; titulo: string; campanha: string; em: string }[]
  orcamentos: PortalOrcamentoResumo[]
  reuniao: {
    id: string; titulo: string; realizada_em: string
    passos: { texto: string; responsavel: string; em_andamento: boolean }[]
  } | null
}

type Decisao =
  | { tipo: 'aprovar'; id: string; titulo: string; sub: string; desde: string | null; prazo: string | null; href: string }
  | { tipo: 'responder'; id: string; titulo: string; sub: string; desde: string | null; prazo: string | null; href: string }
  | { tipo: 'orcamento'; id: string; titulo: string; sub: string; desde: string | null; prazo: null; href: string }

const brl = (v: number) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** Hoje no fuso de Brasília (YYYY-MM-DD). */
function hojeBR(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)
}
function diasEntre(deISO: string, ateISO: string): number {
  return Math.round((Date.parse(ateISO.slice(0, 10)) - Date.parse(deISO.slice(0, 10))) / 86400000)
}
function haQuanto(desde: string | null, hoje: string): string {
  if (!desde) return ''
  const d = diasEntre(desde, hoje)
  if (d <= 0) return 'chegou hoje'
  if (d === 1) return 'há 1 dia'
  return `há ${d} dias`
}
function dataCurta(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}`
}

/** Pílula da fase: neutra; só o que é do cliente ganha cor. */
function FasePill({ fase }: { fase: string }) {
  const cor = fase === 'Aguardando você' ? 'bg-orange-100 text-orange-700'
    : fase === 'Sua aprovação' ? 'bg-green-100 text-green-700'
    : 'bg-gray-100 text-gray-600'
  return <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${cor}`}>{fase}</span>
}

/** Painel do cliente — feito para abrir a reunião: o que depende dele vem primeiro. */
export default async function PortalPainelPage() {
  const claims = await sessaoPortal()
  if (!claims) redirect('/portal')
  const preview = claims.preview === true
  const temSenha = preview ? true : await portalTemSenha(claims.portalSub)

  const supabase = await createPortalClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('portal_dashboard')

  // NÃO redirecionar pro /portal aqui: com o cookie ainda válido ele voltaria
  // pra cá e viraria loop. Acesso desativado/erro → estado de erro com "Sair".
  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 sm:p-10 w-full max-w-md text-center">
          <h1 className="text-xl font-semibold text-gray-900">Painel indisponível</h1>
          <p className="text-gray-500 mt-2 mb-6 text-sm leading-relaxed">
            Seu acesso pode ter sido desativado ou houve uma falha temporária.
            Saia e peça um novo link. Se não resolver, fale com o seu atendimento.
          </p>
          <form action={sairPortal}>
            <button
              type="submit"
              className="w-full px-4 py-3 rounded-xl text-[#fff] font-medium bg-orange-600 hover:bg-orange-700 transition-colors"
            >
              Sair
            </button>
          </form>
        </div>
      </div>
    )
  }

  const dash = data as PortalDashboard
  const tarefas = dash.tarefas ?? []
  const orcamentos = dash.orcamentos ?? []
  const entregues = dash.entregues ?? []
  const hoje = hojeBR()

  // Atas publicadas pelo atendimento (mig. 306). Falhou? O painel segue sem elas.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: atasRaw } = await (supabase as any).rpc('portal_reunioes')
  const atas = (Array.isArray(atasRaw) ? atasRaw : []) as
    { id: string; titulo: string; realizada_em: string; passos_cliente: number }[]

  // ── 1. Decisões com o cliente (mais antigas primeiro) ──
  const decisoes: Decisao[] = [
    ...tarefas.filter(t => t.coluna === 'aprovacao' && !t.decidido).map(t => ({
      tipo: 'aprovar' as const, id: t.id, titulo: t.titulo, sub: t.campanha,
      desde: t.desde, prazo: t.prazo, href: `/portal/aprovacao/${t.id}`,
    })),
    ...tarefas.filter(t => t.coluna === 'pendente' && !t.respondido).map(t => ({
      tipo: 'responder' as const, id: t.id, titulo: t.titulo, sub: t.campanha,
      desde: t.desde, prazo: t.prazo, href: `/portal/pendencia/${t.id}`,
    })),
    ...orcamentos.filter(o => o.estado === 'aguardando').map(o => ({
      tipo: 'orcamento' as const, id: o.id, titulo: o.titulo,
      sub: `Orçamento${o.numero ? ` ${[o.serie, o.numero].filter(Boolean).join(' ')}` : ''} · ${brl(o.valor)}`,
      desde: null, prazo: null, href: `/portal/orcamento/${o.id}`,
    })),
  ].sort((a, b) => (a.desde ?? '9999').localeCompare(b.desde ?? '9999'))

  // ── 2. Próximas entregas: atrasadas + próximas 4 semanas ──
  const limite = new Date(Date.parse(hoje) + 28 * 86400000).toISOString().slice(0, 10)
  const entregas = tarefas
    .filter(t => t.prazo && t.prazo <= limite)
    .sort((a, b) => a.prazo!.localeCompare(b.prazo!))
    .slice(0, 10)

  // ── 3. Em andamento, por campanha ──
  const porCampanha = new Map<string, PortalTarefa[]>()
  for (const t of tarefas) {
    const k = t.campanha || 'Sem campanha'
    porCampanha.set(k, [...(porCampanha.get(k) ?? []), t])
  }

  const passos = dash.reuniao?.passos ?? []
  const passosCliente = passos.filter(p => p.responsavel === 'cliente')
  const passosAgencia = passos.filter(p => p.responsavel !== 'cliente')

  const cardCls = 'bg-white rounded-2xl border border-gray-200 shadow-sm'
  const linhaCls = 'group flex items-center gap-3 rounded-xl bg-gray-50 px-3.5 py-2.5 hover:bg-gray-100 transition-colors'

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-10">
      <AutoRefresh intervalMs={30000} />

      <header className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <FlowMark size={40} />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-gray-900 truncate">{dash.cliente?.nome ?? 'Painel'}</h1>
            <p className="text-sm text-gray-500 truncate">
              {preview ? `Visão do cliente${dash.agencia ? ` · ${dash.agencia}` : ''}` : `Olá, ${dash.usuario.nome}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <PortalNav atual="painel" />
          {!preview && (
            <Link
              href="/portal/solicitar"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-[#fff] bg-orange-600 hover:bg-orange-700 transition-colors active:scale-[0.97]"
            >
              <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Nova solicitação</span>
            </Link>
          )}
          {!preview && <SenhaPortalButton temSenha={temSenha} />}
          <PortalThemeToggle />
          <form action={sairPortal}>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
            >
              <LogOut className="w-4 h-4" /> <span className="hidden sm:inline">{preview ? 'Voltar ao Flow' : 'Sair'}</span>
            </button>
          </form>
        </div>
      </header>

      {/* 1. Decisões */}
      <section className={`${cardCls} p-5 sm:p-6`}>
        <div className="flex items-end gap-4">
          <p className={`text-5xl font-semibold tabular-nums leading-none ${decisoes.length ? 'text-orange-600' : 'text-gray-300'}`}>
            {decisoes.length}
          </p>
          <div className="pb-0.5">
            <h2 className="font-semibold text-gray-900">
              {decisoes.length === 1 ? 'Decisão com você' : 'Decisões com você'}
            </h2>
            <p className="text-sm text-gray-500">
              {decisoes.length ? 'Aprovações, respostas e orçamentos que a agência aguarda' : 'Nada esperando por você agora'}
            </p>
          </div>
        </div>

        {decisoes.length > 0 && (
          <ul className="mt-5 space-y-2">
            {decisoes.map(d => {
              const chip = d.tipo === 'aprovar' ? { t: 'Aprovar', c: 'bg-green-100 text-green-700' }
                : d.tipo === 'responder' ? { t: 'Responder', c: 'bg-orange-100 text-orange-700' }
                : { t: 'Orçamento', c: 'bg-gray-200 text-gray-700' }
              const parado = haQuanto(d.desde, hoje)
              return (
                <li key={`${d.tipo}-${d.id}`}>
                  <Link href={d.href} className={`${linhaCls} py-3`}>
                    <span className={`shrink-0 w-[84px] text-center text-xs font-semibold px-2 py-1 rounded-lg ${chip.c}`}>{chip.t}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-gray-900 truncate">{d.titulo}</span>
                      <span className="block text-xs text-gray-500 truncate">
                        {[d.sub, parado, d.prazo ? `entrega ${dataCurta(d.prazo)}` : ''].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <ArrowRight className="w-4 h-4 text-gray-400 shrink-0 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        {/* 2. Próximas entregas */}
        <section className={`${cardCls} p-4`}>
          <div className="flex items-center gap-2 px-1 mb-3">
            <CalendarDays className="w-4 h-4 text-orange-600" />
            <h2 className="font-semibold text-gray-900">Próximas entregas</h2>
            <span className="text-xs text-gray-400 ml-auto">próximas 4 semanas</span>
          </div>
          {entregas.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">Nenhuma data nas próximas semanas</p>
          ) : (
            <ul className="space-y-1.5">
              {entregas.map(t => {
                const [, m, d] = t.prazo!.split('-')
                const passou = t.prazo! < hoje
                return (
                  <li key={t.id} className="flex items-center gap-3 rounded-xl bg-gray-50 px-3 py-2.5">
                    <span className={`shrink-0 w-11 text-center leading-tight ${passou ? 'text-orange-600' : 'text-gray-900'}`}>
                      <span className="block text-base font-semibold tabular-nums">{d}</span>
                      <span className="block text-[10px] uppercase tracking-wide text-gray-500">{MESES[Number(m) - 1]}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-gray-900 truncate">{t.titulo}</span>
                      <span className="block text-xs text-gray-500 truncate">{t.campanha}</span>
                    </span>
                    <FasePill fase={t.fase} />
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* 3. Última reunião */}
        <section className={`${cardCls} p-4`}>
          <div className="flex items-center gap-2 px-1 mb-3">
            <NotebookPen className="w-4 h-4 text-orange-600" />
            <h2 className="font-semibold text-gray-900">Última reunião</h2>
            {dash.reuniao && (
              <span className="text-xs text-gray-400 ml-auto tabular-nums">{dataBR(dash.reuniao.realizada_em)}</span>
            )}
          </div>
          {!dash.reuniao ? (
            <p className="text-sm text-gray-400 text-center py-6">Nenhuma ata publicada ainda</p>
          ) : (
            <>
              <Link href={`/portal/reunioes/${dash.reuniao.id}`} className={linhaCls}>
                <span className="text-sm font-medium text-gray-900 truncate flex-1">{dash.reuniao.titulo}</span>
                <ArrowRight className="w-3.5 h-3.5 text-gray-400 shrink-0 transition-transform group-hover:translate-x-0.5" />
              </Link>
              {passos.length === 0 ? (
                <p className="text-sm text-gray-500 px-1 mt-3">✓ Tudo o que foi combinado já está feito.</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {[{ t: 'Com você', l: passosCliente }, { t: 'Com a agência', l: passosAgencia }]
                    .filter(g => g.l.length > 0)
                    .map(g => (
                      <div key={g.t}>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 px-1 mb-1">{g.t}</p>
                        <ul className="space-y-1">
                          {g.l.map((p, i) => (
                            <li key={i} className="flex items-start gap-2 px-1 text-sm text-gray-700">
                              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" />
                              <span className="flex-1 leading-snug">{p.texto}</span>
                              {p.em_andamento && <span className="shrink-0 text-[11px] text-gray-500">em andamento</span>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* 4. Em andamento, por campanha */}
      <section className={`${cardCls} p-4 mt-4`}>
        <div className="flex items-center gap-2 px-1 mb-3">
          <Layers className="w-4 h-4 text-orange-600" />
          <h2 className="font-semibold text-gray-900">Em andamento</h2>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 ml-1">{tarefas.length}</span>
        </div>
        {tarefas.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">Nenhum trabalho em andamento</p>
        ) : (
          <div className="space-y-4">
            {[...porCampanha.entries()].map(([campanha, lista]) => (
              <div key={campanha}>
                <p className="text-xs font-semibold text-gray-500 px-1 mb-1.5">{campanha}</p>
                <ul className="space-y-1">
                  {lista.map(t => {
                    const nota = t.decidido === 'aprovacao' ? 'aprovado por você'
                      : t.decidido === 'ajuste' ? 'ajustes enviados'
                      : t.respondido ? 'resposta enviada' : ''
                    const href = t.coluna === 'aprovacao' ? `/portal/aprovacao/${t.id}`
                      : t.coluna === 'pendente' ? `/portal/pendencia/${t.id}` : null
                    const corpo = (
                      <>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-gray-900 truncate">{t.titulo}</span>
                          {nota && <span className="block text-xs text-gray-500">{nota}</span>}
                        </span>
                        {t.prazo && (
                          <span className={`shrink-0 text-xs tabular-nums ${t.prazo < hoje ? 'text-orange-600' : 'text-gray-500'}`}>
                            {dataCurta(t.prazo)}
                          </span>
                        )}
                        <FasePill fase={t.fase} />
                      </>
                    )
                    return (
                      <li key={t.id}>
                        {href
                          ? <Link href={href} className={linhaCls}>{corpo}</Link>
                          : <div className="flex items-center gap-3 rounded-xl bg-gray-50 px-3.5 py-2.5">{corpo}</div>}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 5. Orçamentos */}
      {orcamentos.length > 0 && (
        <section className={`${cardCls} p-4 mt-4`}>
          <div className="flex items-center gap-2 px-1 mb-3">
            <Receipt className="w-4 h-4 text-orange-600" />
            <h2 className="font-semibold text-gray-900">Orçamentos</h2>
          </div>
          <ul className="space-y-1.5">
            {orcamentos.map(o => (
              <li key={o.id}>
                <Link href={`/portal/orcamento/${o.id}`} className={linhaCls}>
                  <span className="min-w-0 flex-1 text-sm font-medium text-gray-900 truncate">{o.titulo}</span>
                  <span className="shrink-0 text-sm text-gray-700 tabular-nums">{brl(o.valor)}</span>
                  <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${
                    o.estado === 'aprovado' ? 'bg-green-100 text-green-700'
                      : o.estado === 'ajuste' ? 'bg-gray-100 text-gray-600' : 'bg-orange-100 text-orange-700'}`}>
                    {o.estado === 'aprovado' ? 'Aprovado' : o.estado === 'ajuste' ? 'Em ajuste' : 'Aguardando você'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 6. Entregues */}
      {entregues.length > 0 && (
        <section className={`${cardCls} p-4 mt-4`}>
          <div className="flex items-center gap-2 px-1 mb-3">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <h2 className="font-semibold text-gray-900">Entregues</h2>
            <span className="text-xs text-gray-400 ml-auto">últimos 30 dias · {entregues.length}</span>
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {entregues.map(e => (
              <li key={e.id} className="flex items-center gap-3 rounded-xl bg-gray-50 px-3.5 py-2">
                <span className="text-xs text-gray-500 tabular-nums shrink-0">{dataCurta(e.em)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-gray-900 truncate">{e.titulo}</span>
                  <span className="block text-xs text-gray-500 truncate">{e.campanha}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 7. Todas as reuniões */}
      {atas.length > 1 && (
        <section className={`${cardCls} p-4 mt-4`}>
          <div className="flex items-center gap-2 px-1 mb-3">
            <NotebookPen className="w-4 h-4 text-orange-600" />
            <h2 className="font-semibold text-gray-900">Reuniões</h2>
          </div>
          <ul className="space-y-1.5">
            {atas.slice(0, 12).map((a) => (
              <li key={a.id}>
                <Link href={`/portal/reunioes/${a.id}`} className={linhaCls}>
                  <span className="text-xs text-gray-500 tabular-nums shrink-0">{dataBR(a.realizada_em)}</span>
                  <span className="text-sm font-medium text-gray-900 truncate flex-1">{a.titulo}</span>
                  {a.passos_cliente > 0 && (
                    <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
                      {a.passos_cliente} com você
                    </span>
                  )}
                  <ArrowRight className="w-3.5 h-3.5 text-gray-400 shrink-0 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-center text-xs text-gray-400 mt-8">
        Atualizado automaticamente · Dúvidas? Fale com o seu atendimento.
      </p>
    </div>
  )
}
