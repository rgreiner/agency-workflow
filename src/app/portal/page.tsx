import { redirect } from 'next/navigation'
import { sessaoPortal } from '@/lib/auth/portal'
import { solicitarAcessoPortal } from '@/app/actions/portal'
import { PortalThemeToggle } from './PortalThemeToggle'

/** Entrada do portal do cliente: pede o e-mail e manda o magic link. */
export default async function PortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ enviado?: string; erro?: string }>
}) {
  if (await sessaoPortal()) redirect('/portal/painel')
  const { enviado, erro } = await searchParams

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <PortalThemeToggle className="fixed top-4 right-4" />
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 sm:p-10 w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-orange-600 mb-4">
            <span className="text-[#fff] font-bold text-2xl">F</span>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">Painel do cliente</h1>
          <p className="text-gray-500 mt-1 text-sm">Acompanhe seus trabalhos com a agência</p>
        </div>

        {enviado === '1' ? (
          <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800 leading-relaxed">
            <p className="font-medium">Confira seu e-mail 📬</p>
            <p className="mt-1">
              Se este e-mail tiver acesso, você recebe um link pra entrar no painel.
              O link vale por 30 minutos.
            </p>
          </div>
        ) : (
          <>
            <p className="mb-6 text-center text-sm text-gray-500 leading-relaxed">
              Sem senha: informe o <span className="font-medium text-gray-700">e-mail cadastrado
              com a agência</span> e a gente manda um link de acesso.
            </p>

            <form action={solicitarAcessoPortal} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  E-mail
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>

              {erro === 'campos' && <p className="text-sm text-red-600">Informe o e-mail.</p>}
              {erro === 'link' && (
                <p className="text-sm text-red-600">
                  Este link expirou ou já foi usado — peça um novo abaixo.
                </p>
              )}

              <button
                type="submit"
                className="w-full px-4 py-3 rounded-xl text-[#fff] font-medium bg-orange-600 hover:bg-orange-700 transition"
              >
                Receber link de acesso
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
