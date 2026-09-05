import Link from 'next/link'
import { login } from '@/app/actions/auth'
import { SubmitButton } from '@/components/ui/SubmitButton'
import { FormComTrava } from '@/components/ui/FormComTrava'
import { emailLembrado } from '@/lib/auth/ultimo-email'
import { FlowMark } from '@/components/brand/FlowMark'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; next?: string; reset?: string }>
}) {
  const { erro, next, reset } = await searchParams
  const email = await emailLembrado()

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-10 w-full max-w-md">
        <div className="mb-6 text-center">
          <FlowMark size={56} className="mx-auto mb-4 drop-shadow-md" />
          <h1 className="text-2xl font-semibold text-gray-900">Flow</h1>
          <p className="text-gray-500 mt-1 text-sm">Gestão em movimento</p>
        </div>

        <p className="mb-6 text-center text-sm text-gray-500 leading-relaxed">
          Acesse com seu <span className="font-medium text-gray-700">e-mail e senha</span> da agência.
          Esqueceu? Toque em <span className="font-medium text-orange-600">Esqueci a senha</span>.
          Ainda sem acesso? Peça um convite ao administrador.
        </p>

        {reset === 'ok' && (
          <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            Senha redefinida! Faça login com a nova senha.
          </div>
        )}

        <FormComTrava action={login} className="space-y-4">
          <input type="hidden" name="next" value={next ?? ''} />

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              defaultValue={email}
              className="w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="senha" className="block text-sm font-medium text-gray-700">
                Senha
              </label>
              <Link href="/recuperar-senha" className="text-xs text-orange-600 hover:text-orange-700">
                Esqueci a senha
              </Link>
            </div>
            <input
              id="senha"
              name="senha"
              type="password"
              autoComplete="current-password"
              required
              autoFocus={!!email}
              className="w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>

          {erro && (
            <p className="text-sm text-red-600">
              {erro === 'campos' ? 'Preencha e-mail e senha.'
                : erro === 'bloqueado' ? 'Muitas tentativas seguidas. O acesso libera sozinho em 15 minutos — ou use “Esqueci a senha”.'
                : 'E-mail ou senha inválidos. Confira o domínio do e-mail (@oneaone.com.br).'}
            </p>
          )}

          <SubmitButton
            pendingLabel="Entrando…"
            className="w-full px-4 py-3 rounded-xl text-[#fff] font-medium bg-orange-600 hover:bg-orange-700"
          >
            Entrar
          </SubmitButton>
        </FormComTrava>
      </div>
    </div>
  )
}
