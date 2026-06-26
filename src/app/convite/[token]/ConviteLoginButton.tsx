import { entrarConvite } from '@/app/actions/auth'

interface ConviteLoginButtonProps {
  token: string
}

export function ConviteLoginButton({ token }: ConviteLoginButtonProps) {
  const action = entrarConvite.bind(null, token)

  return (
    <form action={action} className="space-y-3">
      <input
        name="nome"
        type="text"
        placeholder="Seu nome (se for criar a conta)"
        className="w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
      />
      <input
        name="email"
        type="email"
        autoComplete="email"
        required
        placeholder="E-mail"
        className="w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
      />
      <input
        name="senha"
        type="password"
        autoComplete="current-password"
        required
        placeholder="Senha"
        className="w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
      />
      <button
        type="submit"
        className="inline-flex items-center justify-center w-full px-6 py-3 text-sm font-medium text-[#fff] bg-orange-600 hover:bg-orange-700 rounded-xl shadow-sm transition-colors"
      >
        Entrar / criar conta
      </button>
    </form>
  )
}
