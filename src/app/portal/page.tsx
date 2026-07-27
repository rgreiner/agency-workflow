import { redirect } from 'next/navigation'
import { sessaoPortal } from '@/lib/auth/portal'
import { PortalThemeToggle } from './PortalThemeToggle'
import { PortalLoginForm } from './PortalLoginForm'

/** Entrada do portal do cliente: senha (acesso recorrente) ou magic link. */
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
          <PortalLoginForm erro={erro} />
        )}
      </div>
    </div>
  )
}
