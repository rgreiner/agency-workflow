import Link from 'next/link'
import { redirect } from 'next/navigation'
import { sessaoPortal } from '@/lib/auth/portal'
import { createPortalClient } from '@/lib/supabase/portal'
import { sairPortal } from '@/app/actions/portal'
import { AutoRefresh } from '@/components/ui/AutoRefresh'
import { LogOut, Clock, Building2, BadgeCheck, Plus, ArrowRight } from 'lucide-react'
import { PortalThemeToggle } from '../PortalThemeToggle'

export const dynamic = 'force-dynamic'

interface PortalTarefa {
  id: string
  titulo: string
  campanha: string
  coluna: 'pendente' | 'agencia' | 'aprovacao'
  /** 'aprovacao' | 'ajuste' | null — o que o cliente já respondeu neste ciclo. */
  decidido?: string | null
  /** Já respondeu esta pendência? */
  respondido?: boolean
}

interface PortalDashboard {
  usuario: { nome: string; email: string }
  cliente: { nome: string } | null
  tarefas: PortalTarefa[]
}

/** Painel do cliente: 3 colunas — o que está com ele × o que está com a agência. */
export default async function PortalPainelPage() {
  if (!(await sessaoPortal())) redirect('/portal')

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
            Saia e peça um novo link — se não resolver, fale com o seu atendimento.
          </p>
          <form action={sairPortal}>
            <button
              type="submit"
              className="w-full px-4 py-3 rounded-xl text-[#fff] font-medium bg-orange-600 hover:bg-orange-700 transition"
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

  const colunas = [
    {
      key: 'pendente' as const,
      titulo: 'Aguardando você',
      descricao: 'A agência precisa de uma informação sua pra seguir',
      accent: 'border-t-orange-500',
      chip: 'bg-orange-100 text-orange-700',
      icon: <Clock className="w-4 h-4 text-orange-600" />,
    },
    {
      key: 'agencia' as const,
      titulo: 'Com a agência',
      descricao: 'Em planejamento ou execução pelo time',
      accent: 'border-t-gray-300',
      chip: 'bg-gray-100 text-gray-600',
      icon: <Building2 className="w-4 h-4 text-gray-500" />,
    },
    {
      key: 'aprovacao' as const,
      titulo: 'Em aprovação',
      descricao: 'Trabalhos aguardando o seu OK',
      accent: 'border-t-green-500',
      chip: 'bg-green-100 text-green-700',
      icon: <BadgeCheck className="w-4 h-4 text-green-600" />,
    },
  ]

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:py-10">
      <AutoRefresh intervalMs={30000} />

      <header className="flex items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-orange-600 shrink-0">
            <span className="text-[#fff] font-bold text-xl">F</span>
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-gray-900 truncate">
              {dash.cliente?.nome ?? 'Painel'}
            </h1>
            <p className="text-sm text-gray-500 truncate">Olá, {dash.usuario.nome}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href="/portal/solicitar"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-[#fff] bg-orange-600 hover:bg-orange-700 transition-colors"
          >
            <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Nova solicitação</span>
          </Link>
          <PortalThemeToggle />
          <form action={sairPortal}>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
            >
              <LogOut className="w-4 h-4" /> Sair
            </button>
          </form>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {colunas.map((col) => {
          const itens = tarefas.filter((t) => t.coluna === col.key)
          return (
            <section
              key={col.key}
              className={`bg-white rounded-2xl border border-gray-200 border-t-4 ${col.accent} shadow-sm flex flex-col`}
            >
              <div className="px-4 pt-4 pb-3">
                <div className="flex items-center gap-2">
                  {col.icon}
                  <h2 className="font-semibold text-gray-900">{col.titulo}</h2>
                  <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full ${col.chip}`}>
                    {itens.length}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">{col.descricao}</p>
              </div>

              <div className="px-3 pb-4 space-y-2">
                {itens.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-6">Nada por aqui agora</p>
                )}
                {itens.map((t) => {
                  if (col.key === 'pendente') {
                    return (
                      <Link
                        key={t.id}
                        href={`/portal/pendencia/${t.id}`}
                        className="group block rounded-xl border border-orange-200 bg-orange-50/50 px-3.5 py-3 hover:border-orange-300 hover:bg-orange-50 transition-colors"
                      >
                        <p className="text-sm font-medium text-gray-900 leading-snug">{t.titulo}</p>
                        <p className="text-xs text-gray-500 mt-1 truncate">{t.campanha}</p>
                        <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-orange-700">
                          {t.respondido ? 'Responder de novo' : 'Responder'}
                          <ArrowRight className="w-3 h-3 transition-transform group-hover:translate-x-0.5" />
                        </span>
                      </Link>
                    )
                  }
                  if (col.key === 'aprovacao') {
                    const decidido = t.decidido ?? null
                    return (
                      <Link
                        key={t.id}
                        href={`/portal/aprovacao/${t.id}`}
                        className={`group block rounded-xl border px-3.5 py-3 transition-colors ${
                          decidido
                            ? 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                            : 'border-green-200 bg-green-50/50 hover:border-green-300 hover:bg-green-50'
                        }`}
                      >
                        <p className="text-sm font-medium text-gray-900 leading-snug">{t.titulo}</p>
                        <p className="text-xs text-gray-500 mt-1 truncate">{t.campanha}</p>
                        <span className={`mt-2 inline-flex items-center gap-1 text-xs font-medium ${
                          decidido === 'aprovacao' ? 'text-green-700'
                            : decidido === 'ajuste' ? 'text-orange-700' : 'text-green-700'
                        }`}>
                          {decidido === 'aprovacao' ? '✓ Aprovado por você'
                            : decidido === 'ajuste' ? 'Ajustes enviados'
                            : <>Ver e aprovar <ArrowRight className="w-3 h-3 transition-transform group-hover:translate-x-0.5" /></>}
                        </span>
                      </Link>
                    )
                  }
                  return (
                    <div
                      key={t.id}
                      className="rounded-xl border border-gray-100 bg-gray-50 px-3.5 py-3"
                    >
                      <p className="text-sm font-medium text-gray-900 leading-snug">{t.titulo}</p>
                      <p className="text-xs text-gray-500 mt-1 truncate">{t.campanha}</p>
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>

      <p className="text-center text-xs text-gray-400 mt-8">
        Atualizado automaticamente · Dúvidas? Fale com o seu atendimento.
      </p>
    </div>
  )
}
