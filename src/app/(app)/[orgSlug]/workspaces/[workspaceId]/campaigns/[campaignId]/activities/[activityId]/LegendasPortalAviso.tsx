'use client'

import { useEffect, useState } from 'react'
import { Globe, ChevronDown, ChevronRight } from 'lucide-react'
import { conferirLegendasPortal } from '@/app/actions/portal'
import type { ConferenciaLegendas } from '@/lib/portal-legendas'

/** Título de peça de rede social: aí a falta de legenda é problema; em impresso, não. */
const SOCIAL = /\b(post|posts|story|stories|carrossel|carrosel|reels?|feed|instagram|facebook|meta|linkedin|tiktok)\b/i

/**
 * Aviso para a equipe ANTES de mandar ao cliente (14/10): quais peças da Preview
 * vão chegar ao portal sem a legenda da Redação. A regra é a do portal — casa
 * tipo + número ("Carrossel 2" no texto ↔ "Carrossel 2 - Card 1.png") — então
 * o conserto é numerar igual nos dois lugares. Só avisa: nunca impede avançar.
 */
export function LegendasPortalAviso({ activityId, titulo }: { activityId: string; titulo: string }) {
  const [r, setR] = useState<ConferenciaLegendas | null>(null)
  const [aberto, setAberto] = useState(false)

  useEffect(() => {
    let vivo = true
    conferirLegendasPortal(activityId).then(res => { if (vivo && res.ok) setR(res.r) }).catch(() => {})
    return () => { vivo = false }
  }, [activityId])

  if (!r) return null
  const social = SOCIAL.test(titulo)

  // Tudo casou: uma linha discreta, sem chamar atenção.
  if (!r.nenhuma && r.semLegenda.length === 0 && r.legendaSemPeca.length === 0) {
    return (
      <p className="mt-4 flex items-center gap-2 text-xs text-gray-500">
        <Globe className="w-3.5 h-3.5 text-green-600" />
        Portal do cliente: {r.total === 1 ? 'a peça vai' : `as ${r.total} peças vão`} com a legenda da Redação.
      </p>
    )
  }
  // Impresso/apresentação sem nenhuma legenda é o normal: não avisa.
  if (r.nenhuma && !social) return null

  const lista = [...r.semLegenda.slice(0, 8), ...(r.semLegenda.length > 8 ? [`+ ${r.semLegenda.length - 8} arquivo(s)`] : [])]
  return (
    <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
      <button type="button" onClick={() => setAberto(v => !v)} className="w-full flex items-start gap-2 text-left">
        <Globe className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
        <span className="flex-1 text-gray-800">
          {r.nenhuma
            ? <>Portal do cliente: nenhuma peça vai com legenda. A Redação não tem blocos com &quot;Legenda:&quot; que batam com o nome das artes.</>
            : <>Portal do cliente: <b>{r.semLegenda.length} de {r.total}</b> {r.semLegenda.length === 1 ? 'peça vai' : 'peças vão'} sem legenda
                {r.legendaSemPeca.length > 0 && <> e {r.legendaSemPeca.length} legenda{r.legendaSemPeca.length > 1 ? 's' : ''} sem arte</>}.</>}
        </span>
        {aberto ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
      </button>
      {aberto && (
        <div className="mt-2 pl-6 space-y-2 text-xs text-gray-600">
          {lista.length > 0 && !r.nenhuma && (
            <div>
              <p className="font-medium text-gray-700">Sem legenda:</p>
              <ul className="list-disc pl-4">{lista.map(n => <li key={n}>{n}</li>)}</ul>
            </div>
          )}
          {r.legendaSemPeca.length > 0 && (
            <div>
              <p className="font-medium text-gray-700">Legenda na Redação sem arte na Preview:</p>
              <ul className="list-disc pl-4">{r.legendaSemPeca.map(n => <li key={n}>{n}</li>)}</ul>
            </div>
          )}
          <p>
            Para casar, o arquivo leva o mesmo tipo e número do bloco da Redação: bloco
            &quot;Carrossel 2&quot; → arquivo &quot;Carrossel 2 - Card 1.png&quot;. Números repetidos no texto não casam.
          </p>
        </div>
      )}
    </div>
  )
}
