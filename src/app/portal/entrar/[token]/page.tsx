import { redirect } from 'next/navigation'
import { tokenPortalValido } from '@/lib/auth/portal'
import { entrarPortal } from '@/app/actions/portal'
import { PortalThemeToggle } from '../../PortalThemeToggle'

/**
 * Aterrissagem do magic link. O token só é CONSUMIDO no clique (POST) — se
 * fosse no GET, o scanner de link do provedor de e-mail queimaria o acesso
 * antes do cliente abrir.
 */
export default async function PortalEntrarPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const valido = await tokenPortalValido(token)
  if (!valido) redirect('/portal?erro=link')

  const entrar = entrarPortal.bind(null, token)

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <PortalThemeToggle className="fixed top-4 right-4" />
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 sm:p-10 w-full max-w-md text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-orange-600 mb-4">
          <span className="text-[#fff] font-bold text-2xl">F</span>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900">Quase lá</h1>
        <p className="text-gray-500 mt-2 mb-6 text-sm leading-relaxed">
          Toque no botão pra entrar no seu painel de acompanhamento.
        </p>
        <form action={entrar}>
          <button
            type="submit"
            className="w-full px-4 py-3 rounded-xl text-[#fff] font-medium bg-orange-600 hover:bg-orange-700 transition"
          >
            Entrar no painel
          </button>
        </form>
      </div>
    </div>
  )
}
