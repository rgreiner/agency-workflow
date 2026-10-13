'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Download, FileText, Loader2, MessageSquarePlus, PartyPopper } from 'lucide-react'
import { decidirOrcamento } from '@/app/actions/portal'

export interface OrcamentoPortal {
  id: string
  titulo: string
  numero: string
  campanha: string | null
  emissao: string | null
  validadeDias: number | null
  valor: number
  honorarios: number
  honorariosPct: number
  observacao: string | null
  situacao: 'aguardando' | 'aprovado'
  itens: { nome: string; descricao: string; quant: string; total: number }[]
  decisao: { kind: 'aprovado' | 'ajuste'; em: string | null; por: string | null } | null
  podeDecidir: boolean
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBR = (iso: string | null) => {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''

export function OrcamentoClient({ orc, preview }: { orc: OrcamentoPortal; preview: boolean }) {
  const router = useRouter()
  const [modo, setModo] = useState<'confirmar' | 'ajuste' | null>(null)
  const [mensagem, setMensagem] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [feito, setFeito] = useState<'aprovado' | 'ajuste' | null>(null)
  const [isPending, startTransition] = useTransition()

  const pdf = `/api/portal/orcamento/${orc.id}`

  function enviar(decisao: 'aprovado' | 'ajuste') {
    setErro(null)
    if (decisao === 'ajuste' && !mensagem.trim()) { setErro('Conte o que precisa mudar.'); return }
    startTransition(async () => {
      const res = await decidirOrcamento(orc.id, decisao, mensagem.trim())
      if (res.error) { setErro(res.error); return }
      setFeito(decisao)
      router.refresh()
    })
  }

  if (feito) {
    return (
      <div className="text-center py-10">
        {feito === 'aprovado'
          ? <PartyPopper className="w-14 h-14 text-green-500 mx-auto mb-4" />
          : <MessageSquarePlus className="w-14 h-14 text-orange-500 mx-auto mb-4" />}
        <h2 className="text-2xl font-semibold text-gray-900">
          {feito === 'aprovado' ? 'Orçamento aprovado!' : 'Pedido de alteração enviado'}
        </h2>
        <p className="text-sm text-gray-500 mt-2 mb-8 leading-relaxed max-w-sm mx-auto">
          {feito === 'aprovado'
            ? 'Sua aprovação ficou registrada com seu nome, a data e a hora. O time já foi avisado e segue com a produção.'
            : 'O atendimento recebeu o que você pediu e volta com o orçamento ajustado.'}
        </p>
        <button
          onClick={() => router.push('/portal/painel')}
          className="px-5 py-2.5 rounded-xl text-[#fff] text-sm font-medium bg-orange-600 hover:bg-orange-700 transition-colors active:scale-[0.97]"
        >
          Voltar ao painel
        </button>
      </div>
    )
  }

  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-wide text-orange-600 mb-1">
        Orçamento{orc.numero ? ` ${orc.numero}` : ''}{orc.campanha ? ` · ${orc.campanha}` : ''}
      </p>
      <h1 className="text-xl font-semibold text-gray-900">{orc.titulo}</h1>
      <p className="text-sm text-gray-500 mt-1">
        {orc.emissao && <>Emitido em {dataBR(orc.emissao)}</>}
        {orc.validadeDias ? <> · válido por {orc.validadeDias} dias</> : null}
      </p>

      {/* Itens com a opção escolhida */}
      <div className="mt-6 rounded-xl border border-gray-100 divide-y divide-gray-100">
        {orc.itens.map((it, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900">{it.nome}</p>
              {it.descricao && <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{it.descricao}</p>}
              {it.quant && <p className="text-xs text-gray-400 mt-0.5">Quantidade: {it.quant}</p>}
            </div>
            <p className="text-sm font-medium text-gray-900 tabular-nums shrink-0">{it.total > 0 ? brl(it.total) : '—'}</p>
          </div>
        ))}
        {orc.honorariosPct > 0 && (
          <div className="flex items-center justify-between px-4 py-3 text-sm text-gray-500">
            <span>Honorários ({orc.honorariosPct.toLocaleString('pt-BR')}%)</span>
            <span className="tabular-nums">{brl(orc.honorarios)}</span>
          </div>
        )}
        <div className="flex items-center justify-between px-4 py-3.5 bg-gray-50 rounded-b-xl">
          <span className="text-sm font-semibold text-gray-900">Total</span>
          <span className="text-lg font-semibold text-gray-900 tabular-nums">{brl(orc.valor)}</span>
        </div>
      </div>

      {orc.observacao && (
        <p className="mt-4 text-sm text-gray-600 leading-relaxed whitespace-pre-line">{orc.observacao}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <a href={`${pdf}?inline=1`} target="_blank" rel="noopener"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl px-3.5 py-2 transition-colors">
          <FileText className="w-4 h-4" /> Ver documento completo
        </a>
        <a href={pdf}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl px-3.5 py-2 transition-colors">
          <Download className="w-4 h-4" /> Baixar PDF
        </a>
      </div>

      {/* Decisão já tomada */}
      {orc.decisao && (
        <div className={`mt-8 rounded-xl px-4 py-3.5 text-sm border-l-2 bg-gray-50 ${
          orc.decisao.kind === 'aprovado' ? 'border-l-green-500' : 'border-l-orange-500'}`}>
          <p className="font-medium text-gray-900">
            {orc.decisao.kind === 'aprovado' ? '✓ Orçamento aprovado' : 'Alteração pedida'}
          </p>
          {(orc.decisao.por || orc.decisao.em) && (
            <p className="text-gray-500 mt-0.5">
              {orc.decisao.por ? `por ${orc.decisao.por}` : ''}{orc.decisao.em ? ` em ${quando(orc.decisao.em)}` : ''}
            </p>
          )}
          {orc.decisao.kind === 'ajuste' && (
            <p className="text-gray-500 mt-0.5">O atendimento volta com o orçamento ajustado.</p>
          )}
        </div>
      )}

      {preview && orc.situacao === 'aguardando' && !orc.decisao && (
        <p className="mt-8 text-sm text-gray-500 text-center">
          Visualização da agência: os botões de aprovar aparecem só para o cliente.
        </p>
      )}

      {orc.podeDecidir && (
        <div className="mt-8 border-t border-gray-100 pt-6">
          {modo === 'ajuste' && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">O que precisa mudar?</label>
              <textarea
                value={mensagem}
                onChange={(e) => setMensagem(e.target.value)}
                rows={4}
                placeholder="Quantidade, material, prazo, valor…"
                className="w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-gray-900 resize-y focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
          )}

          {modo === 'confirmar' && (
            <div className="mb-4 rounded-xl bg-gray-50 px-4 py-3.5 text-sm text-gray-700 leading-relaxed">
              Confirma a aprovação de <b>{orc.titulo}</b> no valor de <b>{brl(orc.valor)}</b>?
              A agência é avisada na hora e segue com a produção.
            </div>
          )}

          {erro && <p className="text-sm text-red-600 mb-3">{erro}</p>}

          <div className="flex flex-col sm:flex-row gap-2.5">
            <button
              onClick={() => (modo === 'confirmar' ? enviar('aprovado') : (setModo('confirmar'), setErro(null)))}
              disabled={isPending}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[#fff] font-medium bg-green-600 hover:bg-green-700 transition-colors active:scale-[0.97] disabled:opacity-50"
            >
              {isPending && modo === 'confirmar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {modo === 'confirmar' ? 'Sim, aprovar orçamento' : 'Aprovar orçamento'}
            </button>
            <button
              onClick={() => (modo === 'ajuste' ? enviar('ajuste') : (setModo('ajuste'), setErro(null)))}
              disabled={isPending}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors active:scale-[0.97] disabled:opacity-50"
            >
              {isPending && modo === 'ajuste' ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquarePlus className="w-4 h-4" />}
              {modo === 'ajuste' ? 'Enviar pedido' : 'Pedir alteração'}
            </button>
          </div>
          <p className="text-xs text-gray-400 text-center mt-3">
            A aprovação fica registrada com seu nome, a data e a hora.
          </p>
        </div>
      )}
    </>
  )
}
