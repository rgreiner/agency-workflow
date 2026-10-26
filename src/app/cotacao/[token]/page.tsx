import { AlertTriangle, Clock } from 'lucide-react'
import { convitePorToken, cotacaoFechada, type DadosFornecedor } from '@/lib/cotacao-server'
import { formatDateBR } from '@/lib/midia'
import { fmtCpfCnpj } from '@/lib/telefone'
import { RespostaForm } from './RespostaForm'

export const dynamic = 'force-dynamic'

function Aviso({ titulo, texto, icone = 'alerta' }: { titulo: string; texto: string; icone?: 'alerta' | 'relogio' }) {
  const Icone = icone === 'alerta' ? AlertTriangle : Clock
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
        <div className="mx-auto w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mb-4">
          <Icone className="w-6 h-6 text-orange-600" />
        </div>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">{titulo}</h1>
        <p className="text-sm text-gray-500 leading-relaxed">{texto}</p>
      </div>
    </div>
  )
}

export default async function CotacaoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const cv = await convitePorToken(token)
  if (!cv) return <Aviso titulo="Link inválido" texto="Este link de cotação não existe ou foi substituído. Peça um novo à agência." />

  const contato = [cv.responsavel, cv.responsavel_email].filter(Boolean).join(' · ')
  const cli = cv.cliente
  const comissao = Number(cv.comissao_pct ?? 0) || 0
  if (cotacaoFechada(cv)) {
    return <Aviso icone="relogio" titulo="Cotação encerrada"
      texto={`O prazo para esta cotação terminou${cv.prazo_resposta ? ` em ${formatDateBR(cv.prazo_resposta)}` : ''}.${contato ? ` Se ainda quiser enviar, fale com ${contato}.` : ''}`} />
  }

  // Dados do fornecedor: o que ele já informou numa resposta anterior, senão o cadastro da agência.
  const dados: DadosFornecedor = cv.dados_fornecedor ?? {
    contato: '',
    cnpj: cv.fornecedor.tax_id ?? '',
    email: (Array.isArray(cv.fornecedor.emails) ? cv.fornecedor.emails : []).map(e => e.email).find(Boolean) ?? '',
    whatsapp: (Array.isArray(cv.fornecedor.telefones) ? cv.fornecedor.telefones : []).map(t => t.numero).find(Boolean) ?? '',
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 sm:py-10">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-orange-600">{cv.agencia} · Pedido de cotação</p>
        <h1 className="text-2xl font-semibold text-gray-900 mt-1">{cv.titulo}</h1>
        <p className="text-sm text-gray-500 mt-1">Para <span className="font-medium text-gray-700">{cv.fornecedor.nome}</span></p>
        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-sm text-gray-600">
          {cv.prazo_resposta && <span>Responder até <b className="text-gray-900">{formatDateBR(cv.prazo_resposta)}</b></span>}
          {contato && <span>Dúvidas: {contato}</span>}
        </div>
      </div>

      {/* Fornecedores pediram: alguns conferem o cadastro do cliente antes de cotar, e a
          comissão da agência entra na conta do preço. */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        {cli?.nome && (
          <div>
            <p className="text-xs font-medium text-gray-400 mb-1">Cliente</p>
            <p className="font-medium text-gray-900">{cli.nome}</p>
            {cli.razao && cli.razao !== cli.nome && <p className="text-gray-600">{cli.razao}</p>}
            {cli.cnpj && <p className="text-gray-600 tabular-nums">CNPJ {fmtCpfCnpj(cli.cnpj)}</p>}
            {(cli.endereco || cli.cidade) && <p className="text-gray-500">{[cli.endereco, [cli.cidade, cli.uf].filter(Boolean).join('/')].filter(Boolean).join(' · ')}</p>}
          </div>
        )}
        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-gray-400 mb-1">Faturamento</p>
            <p className="text-gray-900">{cv.faturar === 'contra_agencia'
              ? <>Nota fiscal em nome da agência (<b>{cv.agencia}</b>)</>
              : <>Nota fiscal em nome do cliente{cli?.razao || cli?.nome ? <> (<b>{cli.razao || cli.nome}</b>)</> : ''}</>}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400 mb-1">Comissão da agência</p>
            {comissao > 0
              ? <p className="text-gray-900"><b>{comissao.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</b> sobre o valor do pedido. A agência emite a nota fiscal da comissão para o seu CNPJ.</p>
              : <p className="text-gray-900">Sem comissão da agência neste pedido.</p>}
          </div>
        </div>
      </div>

      <RespostaForm
        token={token}
        mensagem={cv.mensagem}
        itens={cv.itens}
        anexosAgencia={cv.anexos}
        respostaAnterior={cv.resposta && 'itens' in cv.resposta ? cv.resposta : null}
        anexosAnteriores={cv.resposta_anexos ?? []}
        dados={dados}
        jaRespondeu={!!cv.respondido_em}
        jaRecusou={!!cv.recusado_em}
        prazo={cv.prazo_resposta}
      />
    </div>
  )
}
