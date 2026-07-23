'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Download, FileText, Film, Image as ImageIcon, MessageSquarePlus,
  CheckCircle2, Loader2, PartyPopper, X,
} from 'lucide-react'
import { registrarDecisao, type ComentarioPeca } from '@/app/actions/portal'

export interface Peca { ref: string; name: string; mime: string; size: number }

interface Props {
  activityId: string
  titulo: string
  campanha: string
  pecas: Peca[]
  /** Já respondido antes: 'aprovacao' | 'ajuste' | null */
  decidido: string | null
}

const urlPeca = (activityId: string, ref: string, download = false) =>
  `/api/portal/peca/${activityId}?ref=${encodeURIComponent(ref)}${download ? '&download=1' : ''}`

export function AprovacaoClient({ activityId, titulo, campanha, pecas, decidido }: Props) {
  const router = useRouter()
  const [coment, setComent] = useState<Record<string, string>>({})
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const [mensagem, setMensagem] = useState('')
  const [modo, setModo] = useState<'ajuste' | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [feito, setFeito] = useState<'aprovado' | 'ajuste' | null>(null)
  const [zoom, setZoom] = useState<Peca | null>(null)
  const [isPending, startTransition] = useTransition()

  const jaRespondido = decidido !== null

  function comentarios(): ComentarioPeca[] {
    return Object.entries(coment)
      .filter(([, v]) => v.trim())
      .map(([ref, v]) => ({ nome: pecas.find((p) => p.ref === ref)?.name ?? 'peça', comentario: v.trim() }))
  }

  function enviar(decisao: 'aprovado' | 'ajuste') {
    setErro(null)
    const cs = comentarios()
    if (decisao === 'ajuste' && !mensagem.trim() && cs.length === 0) {
      setErro('Conte o que precisa ser ajustado — no campo abaixo ou comentando uma peça.')
      return
    }
    startTransition(async () => {
      const res = await registrarDecisao(activityId, decisao, mensagem.trim(), cs)
      if (res.error) { setErro(res.error); return }
      setFeito(decisao)
    })
  }

  // ── Estado final: aceite dado agora ──
  if (feito === 'aprovado') {
    return (
      <div className="text-center py-10">
        <PartyPopper className="w-14 h-14 text-green-500 mx-auto mb-4" />
        <h2 className="text-2xl font-semibold text-gray-900">Tudo certo por aqui! 🎉</h2>
        <p className="text-sm text-gray-500 mt-2 mb-8 leading-relaxed max-w-sm mx-auto">
          Sua aprovação foi registrada e o time já foi avisado. Obrigado pela parceria —
          é muito bom trabalhar com você.
        </p>
        <button
          onClick={() => router.push('/portal/painel')}
          className="px-5 py-2.5 rounded-xl text-[#fff] text-sm font-medium bg-orange-600 hover:bg-orange-700 transition"
        >
          Voltar ao painel
        </button>
      </div>
    )
  }
  if (feito === 'ajuste') {
    return (
      <div className="text-center py-10">
        <CheckCircle2 className="w-14 h-14 text-orange-500 mx-auto mb-4" />
        <h2 className="text-2xl font-semibold text-gray-900">Ajustes enviados</h2>
        <p className="text-sm text-gray-500 mt-2 mb-8 leading-relaxed max-w-sm mx-auto">
          O time de atendimento recebeu seus apontamentos e vai retornar com a nova versão.
        </p>
        <button
          onClick={() => router.push('/portal/painel')}
          className="px-5 py-2.5 rounded-xl text-[#fff] text-sm font-medium bg-orange-600 hover:bg-orange-700 transition"
        >
          Voltar ao painel
        </button>
      </div>
    )
  }

  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-wide text-orange-600 mb-1">{campanha}</p>
      <h1 className="text-xl font-semibold text-gray-900">{titulo}</h1>

      {jaRespondido ? (
        <div className={`mt-4 rounded-xl border p-4 text-sm ${
          decidido === 'aprovacao'
            ? 'border-green-200 bg-green-50 text-green-800'
            : 'border-orange-200 bg-orange-50 text-orange-800'
        }`}>
          {decidido === 'aprovacao'
            ? 'Você já aprovou este trabalho. O time está com ele.'
            : 'Você já enviou ajustes. O time está trabalhando na nova versão.'}
        </div>
      ) : (
        <p className="text-sm text-gray-500 mt-1 leading-relaxed">
          Confira as peças abaixo. Você pode comentar em cada uma e depois <b>aprovar</b> ou
          <b> pedir ajustes</b>.
        </p>
      )}

      {/* Peças */}
      <div className="mt-6 space-y-4">
        {pecas.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">
            As peças ainda não estão disponíveis. Fale com o seu atendimento.
          </p>
        )}

        {pecas.map((p) => {
          const isImg = p.mime.startsWith('image/')
          const isVid = p.mime.startsWith('video/')
          const isPdf = p.mime === 'application/pdf'
          const aberto = abertos.has(p.ref)
          return (
            <div key={p.ref} className="rounded-2xl border border-gray-200 overflow-hidden bg-white">
              {/* Visual */}
              {isImg && (
                <button onClick={() => setZoom(p)} className="block w-full bg-gray-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={urlPeca(activityId, p.ref)} alt={p.name}
                    className="w-full max-h-[70vh] object-contain" />
                </button>
              )}
              {isVid && (
                <video controls preload="metadata" className="w-full max-h-[70vh] bg-black"
                  src={urlPeca(activityId, p.ref)} />
              )}
              {isPdf && (
                <object data={urlPeca(activityId, p.ref)} type="application/pdf"
                  className="w-full h-[70vh] bg-gray-100">
                  <p className="p-6 text-sm text-gray-500">
                    Seu navegador não abre PDF aqui — use o botão Baixar.
                  </p>
                </object>
              )}

              {/* Barra da peça */}
              <div className="flex items-center gap-2 px-3.5 py-2.5 border-t border-gray-100">
                {isImg ? <ImageIcon className="w-4 h-4 shrink-0 text-gray-400" />
                  : isVid ? <Film className="w-4 h-4 shrink-0 text-gray-400" />
                  : <FileText className="w-4 h-4 shrink-0 text-gray-400" />}
                <span className="flex-1 min-w-0 truncate text-sm text-gray-700">{p.name}</span>

                {!jaRespondido && (
                  <button
                    onClick={() => setAbertos((s) => {
                      const n = new Set(s); n.has(p.ref) ? n.delete(p.ref) : n.add(p.ref); return n
                    })}
                    className={`inline-flex items-center gap-1.5 text-xs font-medium rounded-lg px-2.5 py-1.5 transition-colors ${
                      coment[p.ref]?.trim()
                        ? 'text-orange-700 bg-orange-100 hover:bg-orange-200'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <MessageSquarePlus className="w-3.5 h-3.5" />
                    {coment[p.ref]?.trim() ? 'Comentada' : 'Comentar'}
                  </button>
                )}

                <a
                  href={urlPeca(activityId, p.ref, true)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg px-2.5 py-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" /> Baixar
                </a>
              </div>

              {aberto && !jaRespondido && (
                <div className="px-3.5 pb-3.5">
                  <textarea
                    value={coment[p.ref] ?? ''}
                    onChange={(e) => setComent((c) => ({ ...c, [p.ref]: e.target.value }))}
                    rows={3}
                    placeholder="O que ajustar nesta peça?"
                    className="w-full px-3.5 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 resize-y focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Decisão */}
      {!jaRespondido && pecas.length > 0 && (
        <div className="mt-8 border-t border-gray-100 pt-6">
          {modo === 'ajuste' && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                O que precisa ser ajustado?
              </label>
              <textarea
                value={mensagem}
                onChange={(e) => setMensagem(e.target.value)}
                rows={4}
                placeholder="Observações gerais sobre o trabalho…"
                className="w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-gray-900 resize-y focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
          )}

          {erro && <p className="text-sm text-red-600 mb-3">{erro}</p>}

          <div className="flex flex-col sm:flex-row gap-2.5">
            <button
              onClick={() => enviar('aprovado')}
              disabled={isPending}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[#fff] font-medium bg-green-600 hover:bg-green-700 transition disabled:opacity-50"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Aprovar trabalho
            </button>
            <button
              onClick={() => (modo === 'ajuste' ? enviar('ajuste') : setModo('ajuste'))}
              disabled={isPending}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition disabled:opacity-50"
            >
              <MessageSquarePlus className="w-4 h-4" />
              {modo === 'ajuste' ? 'Enviar ajustes' : 'Pedir ajustes'}
            </button>
          </div>
          <p className="text-xs text-gray-400 text-center mt-3">
            A aprovação fica registrada com seu nome e a data.
          </p>
        </div>
      )}

      {/* Lightbox da imagem */}
      {zoom && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setZoom(null)}
        >
          <button
            aria-label="Fechar"
            className="absolute top-4 right-4 p-2 rounded-xl text-[#fff] hover:bg-white/10 transition-colors"
            onClick={() => setZoom(null)}
          >
            <X className="w-6 h-6" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={urlPeca(activityId, zoom.ref)} alt={zoom.name}
            className="max-w-full max-h-full object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  )
}
