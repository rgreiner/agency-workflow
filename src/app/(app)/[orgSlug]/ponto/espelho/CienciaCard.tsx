'use client'

import { useState, useEffect, useCallback, useTransition } from 'react'
import { AlertTriangle, Check, Loader2, MessageCircleQuestion, CheckCheck } from 'lucide-react'
import { toast } from 'sonner'
import { darCiencia, carregarCiencias, type Ciencia } from '@/app/actions/rh-calendario'

const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const LABEL: Record<string, string> = {
  ajustado: 'marcação ajustada pelo RH',
  intervalo_curto: 'almoço abaixo de 1h',
  extra_pendente: 'hora extra aguardando aprovação',
  sem_marcacao: 'dia sem marcação',
}

/**
 * Ciência dia a dia das divergências. Sem isso, "conferi e concordo" não diz nada:
 * a pessoa precisa ser informada de CADA exceção e escolher entre aceitar ou
 * pedir explicação. Assinar exige todas resolvidas.
 */
export function CienciaCard({ orgSlug, colaboradorId, competencia, onMudou }: {
  orgSlug: string; colaboradorId: string; competencia: string; onMudou?: () => void
}) {
  const [ciencias, setCiencias] = useState<Ciencia[]>([])
  const [pendentes, setPendentes] = useState<{ data: string; divergencia: string }[]>([])
  const [pedindo, setPedindo] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const [pending, start] = useTransition()

  const carregar = useCallback(async () => {
    const r = await carregarCiencias(orgSlug, colaboradorId, competencia)
    if (!r?.error) { setCiencias(r?.ciencias ?? []); setPendentes(r?.pendentes ?? []) }
  }, [orgSlug, colaboradorId, competencia])

  useEffect(() => { carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  function registrar(data: string, div: string, decisao: 'ciente' | 'explicacao', txt?: string) {
    start(async () => {
      const r = await darCiencia(orgSlug, colaboradorId, competencia, data, div, decisao, txt)
      if (r?.error) toast.error(r.error)
      else {
        toast.success(decisao === 'ciente' ? 'Ciência registrada.' : 'Pedido enviado ao RH.')
        setPedindo(null); setTexto(''); carregar(); onMudou?.()
      }
    })
  }

  const abertas = ciencias.filter(c => c.decisao === 'explicacao' && !c.respondido_em)
  if (!pendentes.length && !ciencias.length) return null

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 mb-5">
      <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-1">
        <AlertTriangle className="w-4 h-4 text-amber-500" /> Divergências do período
      </h2>
      <p className="text-xs text-gray-500 mb-3">
        Dê ciência de cada uma antes de assinar. Se algo não bate, peça explicação ao RH em vez de aceitar.
      </p>

      {pendentes.length > 0 && (
        <div className="space-y-2 mb-3">
          {pendentes.map(p => {
            const k = `${p.data}|${p.divergencia}`
            return (
              <div key={k} className="rounded-xl bg-amber-50 ring-1 ring-amber-200 px-3 py-2.5">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-[12rem] text-sm text-gray-700">
                    <b className="tabular-nums">{dataBR(p.data)}</b> — {LABEL[p.divergencia] ?? p.divergencia}
                  </div>
                  <button onClick={() => registrar(p.data, p.divergencia, 'ciente')} disabled={pending}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-[#fff] hover:bg-emerald-700 disabled:opacity-50 transition">
                    <Check className="w-3.5 h-3.5" /> Estou ciente
                  </button>
                  <button onClick={() => setPedindo(pedindo === k ? null : k)} disabled={pending}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 transition">
                    <MessageCircleQuestion className="w-3.5 h-3.5" /> Pedir explicação
                  </button>
                </div>
                {pedindo === k && (
                  <div className="flex gap-2 mt-2">
                    <input value={texto} onChange={e => setTexto(e.target.value)} autoFocus
                      placeholder="O que precisa ser esclarecido?"
                      className="flex-1 px-3 py-2 bg-white border border-amber-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500" />
                    <button onClick={() => registrar(p.data, p.divergencia, 'explicacao', texto)} disabled={pending || !texto.trim()}
                      className="px-3 py-2 text-xs font-medium rounded-lg bg-orange-600 text-[#fff] hover:bg-orange-700 disabled:opacity-50 transition">
                      {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Enviar'}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {ciencias.length > 0 && (
        <div className="space-y-1.5">
          {ciencias.map(c => (
            <div key={`${c.data}|${c.divergencia}`} className="text-xs rounded-lg bg-gray-50 px-3 py-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="tabular-nums text-gray-500">{dataBR(c.data)}</span>
                <span className="text-gray-600">{LABEL[c.divergencia] ?? c.divergencia}</span>
                {c.decisao === 'ciente'
                  ? <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700"><CheckCheck className="w-3 h-3" />ciente</span>
                  : <span className={`text-[10px] px-1.5 py-0.5 rounded ${c.respondido_em ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700'}`}>
                      {c.respondido_em ? 'respondida' : 'aguardando o RH'}
                    </span>}
              </div>
              {c.texto && <div className="text-gray-500 mt-1">Você: “{c.texto}”</div>}
              {c.resposta && <div className="text-gray-700 mt-0.5">RH: “{c.resposta}”</div>}
            </div>
          ))}
        </div>
      )}

      {!!abertas.length && (
        <p className="text-[11px] text-amber-700 mt-3">
          {abertas.length} pedido(s) de explicação sem resposta — você só assina depois que o RH responder.
        </p>
      )}
    </div>
  )
}
