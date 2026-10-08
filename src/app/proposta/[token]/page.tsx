import { AlertTriangle, CalendarClock, CheckCircle2, Clock, MapPin } from 'lucide-react'
import { admissaoPorToken, propostaVencida } from '@/lib/admissao-server'
import { PropostaClient } from './PropostaClient'
import { FichaForm } from './FichaForm'
import type { FichaAdmissao } from '@/lib/admissao-ficha'

export const dynamic = 'force-dynamic'

const dataBR = (d?: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '')
const dataHoraBR = (d?: string | null) => (d
  ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '')

function Aviso({ titulo, texto, icone: Icone = AlertTriangle }: {
  titulo: string; texto: string; icone?: typeof AlertTriangle
}) {
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

export default async function PropostaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const p = await admissaoPorToken(token)
  if (!p) return <Aviso titulo="Link inválido" texto="Esta proposta não existe mais ou foi substituída. Fale com a agência para receber um novo link." />

  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  if (propostaVencida(p, hoje)) {
    return <Aviso icone={Clock} titulo="Prazo encerrado"
      texto={`Esta proposta valia até ${dataBR(p.expira_em)}. Se ainda tiver interesse, fale com a ${p.agencia} para receber uma nova.`} />
  }
  if (p.recusada_em) {
    return <Aviso titulo="Resposta registrada"
      texto={`Você respondeu que não vai seguir com esta proposta em ${dataHoraBR(p.recusada_em)}. Se foi engano, fale com a ${p.agencia}.`} />
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 sm:py-10">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-orange-600">{p.agencia}</p>
        <h1 className="text-2xl font-semibold text-gray-900 mt-1">Proposta de trabalho</h1>
        <p className="text-sm text-gray-500 mt-1">
          Para <span className="font-medium text-gray-700">{p.nome}</span>
          {p.cargo && <> · {p.cargo}</>}
        </p>
      </div>

      {p.aceita_em ? (
        <>
          <div className="bg-white rounded-2xl border border-emerald-200 p-6 sm:p-8">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Proposta aceita</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  Registrado em {dataHoraBR(p.aceita_em)}{p.data_inicio && <> · início previsto para {dataBR(p.data_inicio)}</>}.
                </p>
              </div>
            </div>
            <article className="mt-5 pt-5 border-t border-gray-100 text-[15px] leading-relaxed text-gray-600 whitespace-pre-line">
              {p.carta}
            </article>
          </div>

          {/* O exame vem ANTES da ficha na tela: é o que trava a admissão e
              tem hora marcada; a ficha a pessoa preenche quando puder. */}
          {(p.exame_local || p.exame_em) && (
            <div className="mt-5 bg-white rounded-2xl border border-gray-200 p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-3">Exame admissional</h2>
              <ol className="space-y-4">
                <li className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-orange-100 text-orange-700 text-xs font-semibold flex items-center justify-center shrink-0">1</span>
                  <div className="text-sm text-gray-600">
                    <b className="text-gray-900 block">Onde e quando</b>
                    {p.exame_em && (
                      <span className="inline-flex items-center gap-1.5 text-gray-800 font-medium">
                        <CalendarClock className="w-3.5 h-3.5" /> {dataHoraBR(p.exame_em)}
                      </span>
                    )}
                    {p.exame_local && (
                      <span className="flex items-start gap-1.5 mt-1">
                        <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-gray-400" /> {p.exame_local}
                      </span>
                    )}
                    {p.exame_horarios && <span className="block mt-1 text-gray-500">{p.exame_horarios}</span>}
                    {p.exame_observacao && <span className="block mt-1 text-gray-500">{p.exame_observacao}</span>}
                  </div>
                </li>
              </ol>
            </div>
          )}

          <div className="mt-5">
            <FichaForm token={token} inicial={(p.ficha as FichaAdmissao) ?? null} enviadaEm={p.ficha_em}
              docsPedidos={p.documentos_pedidos ?? []} docsEnviados={p.documentos ?? []} />
          </div>
        </>
      ) : (
        <>
          <PropostaClient token={token} carta={p.carta ?? ''} jaRespondeu={false} />
          {p.expira_em && (
            <p className="mt-4 text-xs text-gray-400">Esta proposta vale até {dataBR(p.expira_em)}.</p>
          )}
        </>
      )}
    </div>
  )
}
