import { AlertTriangle } from 'lucide-react'
import { cadastroPorToken, type CadastroResposta } from '@/lib/fornecedor-cadastro'
import { fmtCpfCnpj } from '@/lib/telefone'
import { CadastroForm } from './CadastroForm'

export const dynamic = 'force-dynamic'

/** Contato do cadastro por papel: o telefone "Financeiro | Ana" vira nome Ana. */
function contatoDe(f: NonNullable<Awaited<ReturnType<typeof cadastroPorToken>>>['fornecedor'], papel: RegExp) {
  const tel = f.telefones.find(t => papel.test(t.tipo ?? ''))
  const email = f.emails.find(e => papel.test(e.tipo ?? ''))
  return {
    nome: (tel?.tipo ?? '').split('|')[1]?.trim() ?? '',
    email: email?.email ?? '',
    whatsapp: tel?.numero ?? '',
  }
}

export default async function CadastroFornecedorPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const cv = await cadastroPorToken(token)
  if (!cv) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
          <div className="mx-auto w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mb-4">
            <AlertTriangle className="w-6 h-6 text-orange-600" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Link inválido</h1>
          <p className="text-sm text-gray-500 leading-relaxed">Este link de cadastro não existe ou foi substituído. Peça um novo à agência.</p>
        </div>
      </div>
    )
  }
  const f = cv.fornecedor
  const end = f.enderecos.find(e => e.cidade) ?? null
  // O que ele já respondeu volta como deixou; senão, o que a agência tem no cadastro.
  const inicial: CadastroResposta = cv.resposta ?? {
    razao: f.razao ?? '', cnpj: f.tax_id ? fmtCpfCnpj(f.tax_id) : '', tipo: f.tipo && f.tipo !== 'Outros' ? f.tipo : '', tags: f.tags ?? [],
    comercial: contatoDe(f, /comerc|vend|orc|atend/i),
    financeiro: contatoDe(f, /financ|nota|fiscal|cobran/i),
    cidade: end?.cidade ?? '', uf: end?.uf ?? '', atende: '', obs: '',
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 sm:py-10">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-orange-600">{cv.agencia} · Cadastro de fornecedor</p>
        <h1 className="text-2xl font-semibold text-gray-900 mt-1">{f.nome}</h1>
        <p className="text-sm text-gray-600 mt-2 leading-relaxed">
          Os pedidos de orçamento da {cv.agencia} passam a sair todos pelo nosso sistema: chega um link, você responde com os valores e
          pode anexar a sua proposta. Para o pedido certo chegar até você, confira os seus dados abaixo — leva uns 2 minutos.
        </p>
      </div>
      <CadastroForm token={token} inicial={inicial} tipos={cv.tipos} jaRespondeu={!!cv.respondido_em} agencia={cv.agencia} />
    </div>
  )
}
