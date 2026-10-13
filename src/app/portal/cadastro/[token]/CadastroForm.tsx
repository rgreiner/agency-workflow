'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cadastrarPortal } from '@/app/actions/portal'
import { SubmitButton } from '@/components/ui/SubmitButton'

const inputCls =
  'w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500'

export function CadastroForm({ token }: { token: string }) {
  const [erro, setErro] = useState<string | null>(null)

  async function enviar(fd: FormData) {
    setErro(null)
    // Sucesso redireciona para o painel; só volta aqui com erro.
    const res = await cadastrarPortal(token, fd)
    if (res?.error) setErro(res.error)
  }

  return (
    <>
      <form action={enviar} className="space-y-4">
        <div>
          <label htmlFor="nome" className="block text-sm font-medium text-gray-700 mb-1">Seu nome</label>
          <input id="nome" name="nome" autoComplete="name" required className={inputCls} />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
          <input id="email" name="email" type="email" autoComplete="email" required className={inputCls} />
        </div>
        <div>
          <label htmlFor="senha" className="block text-sm font-medium text-gray-700 mb-1">Crie uma senha</label>
          <input id="senha" name="senha" type="password" autoComplete="new-password" minLength={6} required className={inputCls} />
          <p className="text-xs text-gray-400 mt-1">Pelo menos 6 caracteres. Esqueceu depois? Dá para receber um link por e-mail.</p>
        </div>
        {erro && <p className="text-sm text-red-600">{erro}</p>}
        <SubmitButton
          pendingLabel="Criando acesso…"
          className="w-full px-4 py-3 rounded-xl text-[#fff] font-medium bg-orange-600 hover:bg-orange-700"
        >
          Criar acesso e entrar
        </SubmitButton>
      </form>
      <Link href="/portal" className="mt-4 block text-center text-sm text-gray-500 hover:text-gray-800 transition-colors">
        Já tenho acesso
      </Link>
    </>
  )
}
