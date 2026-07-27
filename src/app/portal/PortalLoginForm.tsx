'use client'

import { useState } from 'react'
import { loginPortalSenha, solicitarAcessoPortal } from '@/app/actions/portal'

const inputCls =
  'w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500'
const btnCls =
  'w-full px-4 py-3 rounded-xl text-[#fff] font-medium bg-orange-600 hover:bg-orange-700 transition'

/** Login do portal: senha (acesso recorrente) OU link por e-mail (1º acesso / esqueci). */
export function PortalLoginForm({ erro }: { erro?: string }) {
  // Se o erro veio do fluxo de link, abre já no modo link.
  const [modo, setModo] = useState<'senha' | 'link'>(erro === 'link' ? 'link' : 'senha')

  if (modo === 'link') {
    return (
      <>
        <p className="mb-6 text-center text-sm text-gray-500 leading-relaxed">
          Informe o <span className="font-medium text-gray-700">e-mail cadastrado com a
          agência</span> e a gente manda um link de acesso — serve pro primeiro acesso e pra
          quando você esquecer a senha.
        </p>
        <form action={solicitarAcessoPortal} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
            <input id="email" name="email" type="email" autoComplete="email" required className={inputCls} />
          </div>
          {erro === 'campos' && <p className="text-sm text-red-600">Informe o e-mail.</p>}
          {erro === 'link' && (
            <p className="text-sm text-red-600">Este link expirou ou já foi usado — peça um novo abaixo.</p>
          )}
          <button type="submit" className={btnCls}>Receber link de acesso</button>
        </form>
        <button
          onClick={() => setModo('senha')}
          className="mt-4 w-full text-center text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          Tenho senha — entrar com e-mail e senha
        </button>
      </>
    )
  }

  return (
    <>
      <p className="mb-6 text-center text-sm text-gray-500 leading-relaxed">
        Entre com seu <span className="font-medium text-gray-700">e-mail e senha</span>.
        Primeiro acesso? Use o link por e-mail e crie sua senha depois.
      </p>
      <form action={loginPortalSenha} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
          <input id="email" name="email" type="email" autoComplete="email" required className={inputCls} />
        </div>
        <div>
          <label htmlFor="senha" className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
          <input id="senha" name="senha" type="password" autoComplete="current-password" required className={inputCls} />
        </div>
        {erro === 'campos' && <p className="text-sm text-red-600">Preencha e-mail e senha.</p>}
        {erro === 'senha' && <p className="text-sm text-red-600">E-mail ou senha inválidos.</p>}
        <button type="submit" className={btnCls}>Entrar</button>
      </form>
      <button
        onClick={() => setModo('link')}
        className="mt-4 w-full text-center text-sm text-gray-500 hover:text-gray-800 transition-colors"
      >
        Primeiro acesso ou esqueci a senha — receber link por e-mail
      </button>
    </>
  )
}
