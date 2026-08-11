import { entrarConvite } from '@/app/actions/auth'
import { SubmitButton } from '@/components/ui/SubmitButton'
import { FormComTrava } from '@/components/ui/FormComTrava'

interface ConviteLoginButtonProps {
  token: string
  erro?: string
}

const MENSAGEM: Record<string, string> = {
  campos: 'Preencha e-mail e senha.',
  credenciais: 'E-mail ou senha inválidos.',
  bloqueado: 'Muitas tentativas seguidas. O acesso libera sozinho em 15 minutos.',
  email: 'Esse e-mail parece ter um erro de digitação. Confira antes de continuar — é com ele que você vai entrar daqui pra frente.',
}

export function ConviteLoginButton({ token, erro }: ConviteLoginButtonProps) {
  const action = entrarConvite.bind(null, token)

  return (
    <FormComTrava action={action} className="space-y-3">
      <input
        name="nome"
        type="text"
        placeholder="Seu nome (se for criar a conta)"
        className="w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
      />
      <input
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
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
      {erro && <p className="text-sm text-red-600">{MENSAGEM[erro] ?? 'Não foi possível entrar.'}</p>}
      <SubmitButton
        pendingLabel="Entrando…"
        className="w-full px-6 py-3 text-sm font-medium text-[#fff] bg-orange-600 hover:bg-orange-700 rounded-xl shadow-sm"
      >
        Entrar / criar conta
      </SubmitButton>
    </FormComTrava>
  )
}
