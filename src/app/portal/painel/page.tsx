import { redirect } from 'next/navigation'
import { sessaoPortal } from '@/lib/auth/portal'
import { createPortalClient } from '@/lib/supabase/portal'
import { sairPortal } from '@/app/actions/portal'
import { AutoRefresh } from '@/components/ui/AutoRefresh'
import { LogOut, Clock, Building2, BadgeCheck } from 'lucide-react'

export const dynamic = 'force-dynamic'

interface PortalTarefa {
  id: string
  titulo: string
  campanha: string
  coluna: 'pendente' | 'agencia' | 'aprovacao'
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
        <form action={sairPortal}>
          <button
            type="submit"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
          >
            <LogOut className="w-4 h-4" /> Sair
          </button>
        </form>
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
                {itens.map((t) => (
                  <div
                    key={t.id}
                    className="rounded-xl border border-gray-100 bg-gray-50 px-3.5 py-3"
                  >
                    <p className="text-sm font-medium text-gray-900 leading-snug">{t.titulo}</p>
                    <p className="text-xs text-gray-500 mt-1 truncate">{t.campanha}</p>
                  </div>
                ))}
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
