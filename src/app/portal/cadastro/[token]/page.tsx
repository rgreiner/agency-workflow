import Link from 'next/link'
import { conviteInfoPortal } from '@/lib/auth/portal'
import { PortalThemeToggle } from '../../PortalThemeToggle'
import { FlowMark } from '@/components/brand/FlowMark'
import { CadastroForm } from './CadastroForm'

export const dynamic = 'force-dynamic'

/**
 * Cadastro pelo link que a agência mandou (mig. 342): nome, e-mail e senha, e o
 * cliente já entra no painel. Abrir o link não gasta nada — o acesso só nasce
 * no envio do formulário.
 */
export default async function PortalCadastroPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const info = await conviteInfoPortal(token)

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <PortalThemeToggle className="fixed top-4 right-4" />
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 sm:p-10 w-full max-w-md">
        <div className="mb-6 text-center">
          <FlowMark size={56} className="mx-auto mb-4 drop-shadow-md" />
          {info ? (
            <>
              <h1 className="text-2xl font-semibold text-gray-900">Painel {info.cliente}</h1>
              <p className="text-gray-500 mt-1 text-sm leading-relaxed">
                Crie seu acesso para acompanhar com a {info.agencia} o que está em andamento,
                aprovar trabalhos e orçamentos e ver as datas de entrega.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-semibold text-gray-900">Link expirado</h1>
              <p className="text-gray-500 mt-2 text-sm leading-relaxed">
                Este link de cadastro não vale mais. Peça um novo ao seu atendimento.
                Se você já tem acesso, entre com o seu e-mail.
              </p>
            </>
          )}
        </div>
        {info ? (
          <CadastroForm token={token} />
        ) : (
          <Link
            href="/portal"
            className="block w-full text-center px-4 py-3 rounded-xl text-[#fff] font-medium bg-orange-600 hover:bg-orange-700 transition-colors"
          >
            Ir para o login
          </Link>
        )}
      </div>
    </div>
  )
}
