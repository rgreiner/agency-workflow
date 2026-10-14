import Link from 'next/link'
import { redirect } from 'next/navigation'
import { sessaoPortal } from '@/lib/auth/portal'
import { createPortalClient } from '@/lib/supabase/portal'
import { sairPortal } from '@/app/actions/portal'
import { AutoRefresh } from '@/components/ui/AutoRefresh'
import { LogOut, ArrowRight, MessageSquarePlus, CalendarDays, Plus } from 'lucide-react'
import { PortalThemeToggle } from '../PortalThemeToggle'
import { PortalNav } from '../PortalNav'
import { FlowMark } from '@/components/brand/FlowMark'

export const dynamic = 'force-dynamic'

interface Tarefa {
  id: string
  titulo: string
  campanha: string
  coluna: 'pendente' | 'agencia' | 'aprovacao'
  fase: string
  prazo: string | null
  decidido?: string | null
  respondido?: boolean | null
  alteracao_em?: string | null
}
interface Dash {
  usuario: { nome: string }
  preview: boolean
  cliente: { nome: string } | null
  tarefas: Tarefa[]
  entregues: { id: string; titulo: string; campanha: string; em: string }[]
}

/** Colunas do quadro: as fases do trabalho como o cliente entende (status interno não sai do banco). */
const COLUNAS = [
  { chave: 'planejamento', titulo: 'Planejamento', fases: ['Planejamento'] },
  { chave: 'criacao', titulo: 'Criação', fases: ['Criação'] },
  { chave: 'voce', titulo: 'Com você', fases: ['Sua aprovação', 'Aguardando você'] },
  { chave: 'producao', titulo: 'Produção', fases: ['Produção'] },
  { chave: 'veiculacao', titulo: 'Veiculação', fases: ['Veiculação', 'Em andamento'] },
] as const

function hojeBR(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)
}
const dataCurta = (iso: string) => { const [, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}` }

/**
 * Quadro do cliente (mig. 343): todos os trabalhos por fase, com a data de
 * entrega e o que ele pode fazer em cada card — aprovar, responder ou pedir
 * alteração. Sem comentários internos, sem briefing.
 */
export default async function PortalQuadroPage() {
  const claims = await sessaoPortal()
  if (!claims) redirect('/portal')
  const preview = claims.preview === true

  const supabase = await createPortalClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('portal_dashboard')
  if (error || !data) redirect('/portal/painel')
  const dash = data as Dash
  const hoje = hojeBR()

  // Dentro da coluna: prazo mais próximo primeiro; sem data vai para o fim.
  const ordenar = (l: Tarefa[]) => [...l].sort((a, b) => (a.prazo ?? '9999').localeCompare(b.prazo ?? '9999'))

  function Card({ t }: { t: Tarefa }) {
    const passou = !!t.prazo && t.prazo < hoje
    let acao: React.ReactNode = null
    if (t.coluna === 'aprovacao') {
      acao = t.decidido === 'aprovacao' ? <span className="text-xs font-medium text-green-600">✓ Aprovado por você</span>
        : t.decidido === 'ajuste' ? <span className="text-xs font-medium text-gray-500">Alteração enviada</span>
        : <Link href={`/portal/aprovacao/${t.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-[#fff] bg-green-600 hover:bg-green-700 rounded-lg px-2.5 py-1.5 transition-colors active:scale-[0.97]">
            Ver e aprovar <ArrowRight className="w-3 h-3" />
          </Link>
    } else if (t.coluna === 'pendente') {
      acao = <Link href={`/portal/pendencia/${t.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-[#fff] bg-orange-600 hover:bg-orange-700 rounded-lg px-2.5 py-1.5 transition-colors active:scale-[0.97]">
          {t.respondido ? 'Responder de novo' : 'Responder'} <ArrowRight className="w-3 h-3" />
        </Link>
    } else {
      acao = (
        <span className="flex items-center gap-2">
          {t.alteracao_em && <span className="text-[11px] text-gray-500">alteração enviada {dataCurta(t.alteracao_em)}</span>}
          <Link href={`/portal/alteracao/${t.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg px-2 py-1 transition-colors">
            <MessageSquarePlus className="w-3.5 h-3.5" /> Solicitar alteração
          </Link>
        </span>
      )
    }
    return (
      <div className={`rounded-xl bg-white border border-gray-200 p-3 shadow-sm ${
        t.coluna === 'aprovacao' && !t.decidido ? 'border-l-2 border-l-green-500'
          : t.coluna === 'pendente' && !t.respondido ? 'border-l-2 border-l-orange-500' : ''}`}>
        <p className="text-sm font-medium text-gray-900 leading-snug">{t.titulo}</p>
        <p className="text-xs text-gray-500 mt-0.5 truncate">{t.campanha}</p>
        <div className="flex items-center gap-1.5 mt-2 text-xs">
          <CalendarDays className={`w-3.5 h-3.5 ${passou ? 'text-orange-600' : 'text-gray-400'}`} />
          <span className={`tabular-nums ${passou ? 'text-orange-600 font-medium' : 'text-gray-600'}`}>
            {t.prazo ? `Entrega ${dataCurta(t.prazo)}` : 'Sem data'}
          </span>
          {(t.fase === 'Sua aprovação' || t.fase === 'Aguardando você') && (
            <span className={`ml-auto text-[11px] font-medium px-2 py-0.5 rounded-full ${
              t.fase === 'Sua aprovação' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
              {t.fase}
            </span>
          )}
        </div>
        {acao && <div className="mt-2.5 flex justify-end">{acao}</div>}
      </div>
    )
  }

  const colunaCls = 'snap-start shrink-0 w-[82%] sm:w-72 lg:w-auto lg:shrink lg:min-w-0 flex flex-col rounded-2xl bg-gray-100 p-2.5'

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6 sm:py-8">
      <AutoRefresh intervalMs={30000} />

      <header className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <FlowMark size={40} />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-gray-900 truncate">{dash.cliente?.nome ?? 'Quadro'}</h1>
            <p className="text-sm text-gray-500 truncate">Todos os trabalhos, por fase</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <PortalNav atual="quadro" />
          {!preview && (
            <Link
              href="/portal/solicitar?de=quadro"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-[#fff] bg-orange-600 hover:bg-orange-700 transition-colors active:scale-[0.97]"
            >
              <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Nova demanda</span>
            </Link>
          )}
          <PortalThemeToggle />
          <form action={sairPortal}>
            <button type="submit" className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors">
              <LogOut className="w-4 h-4" /> <span className="hidden sm:inline">{preview ? 'Voltar ao Flow' : 'Sair'}</span>
            </button>
          </form>
        </div>
      </header>

      {/* Celular/tablet: rolagem lateral com encaixe. Tela grande: 6 colunas lado a lado. */}
      <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-3 lg:grid lg:grid-cols-6 lg:overflow-visible">
        {COLUNAS.map(col => {
          const lista = ordenar(dash.tarefas.filter(t => (col.fases as readonly string[]).includes(t.fase)))
          const destaque = col.chave === 'voce' && lista.some(t => (t.coluna === 'aprovacao' && !t.decidido) || (t.coluna === 'pendente' && !t.respondido))
          return (
            <section key={col.chave} className={`${colunaCls} ${destaque ? 'ring-2 ring-orange-500/40' : ''}`}>
              <div className="flex items-center gap-2 px-1.5 pb-2.5">
                <h2 className="text-sm font-semibold text-gray-900">{col.titulo}</h2>
                <span className="ml-auto text-xs font-semibold text-gray-500 tabular-nums">{lista.length}</span>
              </div>
              <div className="space-y-2">
                {lista.length === 0 && <p className="text-xs text-gray-400 text-center py-6">Nada aqui</p>}
                {lista.map(t => <Card key={t.id} t={t} />)}
              </div>
            </section>
          )
        })}

        <section className={colunaCls}>
          <div className="flex items-center gap-2 px-1.5 pb-2.5">
            <h2 className="text-sm font-semibold text-gray-900">Entregue</h2>
            <span className="text-[11px] text-gray-400">30 dias</span>
            <span className="ml-auto text-xs font-semibold text-gray-500 tabular-nums">{dash.entregues.length}</span>
          </div>
          <div className="space-y-2">
            {dash.entregues.length === 0 && <p className="text-xs text-gray-400 text-center py-6">Nada aqui</p>}
            {dash.entregues.map(e => (
              <div key={e.id} className="rounded-xl bg-white/70 border border-gray-200 p-3">
                <p className="text-sm text-gray-700 leading-snug">{e.titulo}</p>
                <p className="text-xs text-gray-500 mt-0.5 truncate">{e.campanha}</p>
                <p className="text-xs text-green-600 mt-1.5">✓ Entregue {dataCurta(e.em)}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <p className="text-center text-xs text-gray-400 mt-6">
        Atualizado automaticamente · Dúvidas? Fale com o seu atendimento.
      </p>
    </div>
  )
}
