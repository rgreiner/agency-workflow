import Link from 'next/link'
import { solicitarReset } from '@/app/actions/auth'

export default async function RecuperarSenhaPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; enviado?: string }>
}) {
  const { erro, enviado } = await searchParams

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-10 w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-orange-600 mb-4">
            <span className="text-[#fff] font-bold text-2xl">F</span>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">Recuperar senha</h1>
          <p className="text-gray-500 mt-1 text-sm">Enviaremos um link para você redefinir sua senha</p>
        </div>

        {enviado ? (
          <div className="space-y-5">
            <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800 leading-relaxed">
              Se existir uma conta com esse e-mail, enviamos um link para redefinir a senha.
              Verifique sua caixa de entrada (e o spam). O link expira em 1 hora.
            </div>
            <Link href="/login" className="block text-center text-sm text-orange-600 hover:text-orange-700">
              Voltar para o login
            </Link>
          </div>
        ) : (
          <form action={solicitarReset} className="space-y-4">
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

            <button
              type="submit"
              className="w-full px-4 py-3 rounded-xl text-white font-medium bg-orange-600 hover:bg-orange-700 transition"
            >
              Enviar link
            </button>

            <Link href="/login" className="block text-center text-sm text-gray-500 hover:text-gray-700">
              Voltar para o login
            </Link>
          </form>
        )}
      </div>
    </div>
  )
}
