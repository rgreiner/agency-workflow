import { login } from '@/app/actions/auth'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; next?: string }>
}) {
  const { erro, next } = await searchParams

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-10 w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-600 mb-4">
            <span className="text-white font-bold text-lg">AW</span>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">Agency Workflow</h1>
          <p className="text-gray-500 mt-1 text-sm">Gestão de pauta e atividades</p>
        </div>

        <form action={login} className="space-y-4">
          <input type="hidden" name="next" value={next ?? ''} />

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
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label htmlFor="senha" className="block text-sm font-medium text-gray-700 mb-1">
              Senha
            </label>
            <input
              id="senha"
              name="senha"
              type="password"
              autoComplete="current-password"
              required
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {erro && (
            <p className="text-sm text-red-600">
              {erro === 'campos' ? 'Preencha e-mail e senha.' : 'E-mail ou senha inválidos.'}
            </p>
          )}

          <button
            type="submit"
            className="w-full px-4 py-3 rounded-xl text-white font-medium bg-indigo-600 hover:bg-indigo-700 transition"
          >
            Entrar
          </button>
        </form>
      </div>
    </div>
  )
}
