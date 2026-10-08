'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, X } from 'lucide-react'

/**
 * A resposta do candidato. Um clique para aceitar (decisão do Rafael): sem
 * código, sem digitar CPF. O servidor guarda data, hora e IP do aceite.
 */
export function PropostaClient({ token, carta, jaRespondeu }: {
  token: string; carta: string; jaRespondeu: boolean
}) {
  const router = useRouter()
  const [enviando, start] = useTransition()
  const [recusando, setRecusando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  // "Abriu o link" vem do browser: o preview do WhatsApp busca a URL e marcaria
  // aberto sem ninguém ter aberto.
  useEffect(() => {
    if (jaRespondeu) return
    fetch(`/api/proposta/${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao: 'abrir' }),
    }).catch(() => {})
  }, [token, jaRespondeu])

  function responder(acao: 'aceitar' | 'recusar') {
    setErro(null)
    start(async () => {
      const r = await fetch(`/api/proposta/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao, motivo: acao === 'recusar' ? motivo : undefined }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErro(j.error ?? 'Não foi possível registrar sua resposta.'); return }
      router.refresh()
    })
  }

  return (
    <>
      <article className="bg-white rounded-2xl border border-gray-200 p-6 sm:p-8 text-[15px] leading-relaxed text-gray-700 whitespace-pre-line">
        {carta}
      </article>

      {erro && (
        <p className="mt-4 rounded-xl bg-red-50 ring-1 ring-red-200 px-4 py-3 text-sm text-red-800">{erro}</p>
      )}

      {recusando ? (
        <div className="mt-5 bg-white rounded-2xl border border-gray-200 p-5">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Quer contar o motivo? <span className="font-normal text-gray-400">(opcional)</span>
          </label>
          <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3} autoFocus
            className="w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-base sm:text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white"
            placeholder="Ex.: aceitei outra proposta" />
          <div className="flex flex-wrap justify-end gap-2 mt-3">
            <button onClick={() => setRecusando(false)} disabled={enviando}
              className="px-4 py-2.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">Voltar</button>
            <button onClick={() => responder('recusar')} disabled={enviando}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-100 active:scale-[0.97] transition-colors disabled:opacity-50">
              {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
              Confirmar que não vou seguir
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-3">
          <button onClick={() => responder('aceitar')} disabled={enviando}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-orange-600 text-[#fff] text-sm font-semibold rounded-xl hover:bg-orange-700 active:scale-[0.97] transition-colors disabled:opacity-50">
            {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Aceito a proposta
          </button>
          <button onClick={() => setRecusando(true)} disabled={enviando}
            className="text-sm text-gray-500 hover:text-gray-800 transition-colors sm:ml-1">
            Não vou seguir
          </button>
        </div>
      )}
    </>
  )
}
