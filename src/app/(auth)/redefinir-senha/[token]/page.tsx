import Link from 'next/link'
import { redefinirSenha } from '@/app/actions/auth'
import { tokenResetValido } from '@/lib/auth/reset'

export default async function RedefinirSenhaPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ erro?: string }>
}) {
  const { token } = await params
  const { erro } = await searchParams
  const valido = await tokenResetValido(token)

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-10 w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-orange-600 mb-4">
            <span className="text-[#fff] font-bold text-2xl">F</span>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">Nova senha</h1>
          <p className="text-gray-500 mt-1 text-sm">Escolha uma nova senha para sua conta</p>
        </div>

        {!valido ? (
          <div className="space-y-5">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 leading-relaxed">
              Este link é inválido ou expirou. Solicite um novo link para redefinir a senha.
            </div>
            <Link href="/recuperar-senha" className="block text-center text-sm text-orange-600 hover:text-orange-700">
              Solicitar novo link
            </Link>
          </div>
        ) : (
          <form action={redefinirSenha.bind(null, token)} className="space-y-4">
            <div>
              <label htmlFor="senha" className="block text-sm font-medium text-gray-700 mb-1">
                Nova senha
              </label>
              <input
                id="senha"
                name="senha"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                className="w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>

            <div>
              <label htmlFor="confirmar" className="block text-sm font-medium text-gray-700 mb-1">
                Confirmar senha
              </label>
              <input
                id="confirmar"
                name="confirmar"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                className="w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>

            {erro && (
              <p className="text-sm text-red-600">
                {erro === 'curta'
                  ? 'A senha deve ter ao menos 8 caracteres.'
                  : erro === 'confere'
                  ? 'As senhas não conferem.'
                  : 'Link inválido ou expirado. Solicite um novo.'}
              </p>
            )}

            <button
              type="submit"
              className="w-full px-4 py-3 rounded-xl text-white font-medium bg-orange-600 hover:bg-orange-700 transition"
            >
              Redefinir senha
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
