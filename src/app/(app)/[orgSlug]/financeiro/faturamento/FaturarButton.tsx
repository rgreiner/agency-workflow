'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Receipt, Send, Loader2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

/**
 * Botões da conferência de Faturamento:
 *  • "Faturar" — só gera o(s) lançamento(s) (como sempre).
 *  • "Faturar e enviar" (quando `enviar` é passado) — fatura E dispara o e-mail
 *    ao cliente com os documentos anexados. NUNCA automático: o financeiro
 *    escolhe, confirma o destinatário e envia.
 * Se faltar NF/Boleto, avisa mas não trava (decisão: só avisar).
 */
export function FaturarButton({ action, missing, okToast, enviar, destinatarioPadrao }: {
  action: () => Promise<{ error?: string } | void>
  missing: string[]
  okToast: string
  enviar?: (destinatario: string) => Promise<{ error?: string }>
  destinatarioPadrao?: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [mode, setMode] = useState<null | 'faturar' | 'enviar'>(null)
  const [dest, setDest] = useState(destinatarioPadrao ?? '')

  const avisoMissing = missing.length > 0 && (
    <span className="inline-flex items-center gap-1 text-amber-600" title={`Faltam: ${missing.join(', ')}`}>
      <AlertTriangle className="w-3.5 h-3.5" /> falta {missing.join(' + ')}
    </span>
  )

  function runFaturar() {
    start(async () => {
      const res = await action()
      if (res?.error) { toast.error(res.error); return }
      toast.success(okToast)
      setMode(null)
      router.refresh()
    })
  }

  function runEnviar() {
    start(async () => {
      const r1 = await action()
      if (r1?.error) { toast.error(r1.error); return }
      const r2 = await enviar!(dest)
      if (r2?.error) { toast.error(r2.error); setMode(null); router.refresh(); return }
      toast.success('Faturado e enviado ao cliente.')
      setMode(null)
      router.refresh()
    })
  }

  // Confirmação do "Faturar e enviar": destinatário editável.
  if (mode === 'enviar') {
    return (
      <span className="inline-flex items-center gap-2 text-xs">
        {avisoMissing}
        <input
          type="email" value={dest} onChange={(e) => setDest(e.target.value)}
          placeholder="financeiro@cliente.com.br"
          className="px-2 py-1 w-52 bg-gray-100 border border-transparent rounded-lg text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
        />
        <button onClick={runEnviar} disabled={pending || !dest.trim()}
          className="font-medium text-orange-600 hover:text-orange-700 inline-flex items-center gap-1 disabled:opacity-50">
          {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <>Faturar e enviar</>}
        </button>
        <button onClick={() => setMode(null)} className="text-gray-400 hover:text-gray-600">Cancelar</button>
      </span>
    )
  }

  // Confirmação do "Faturar" simples.
  if (mode === 'faturar') {
    return (
      <span className="inline-flex items-center gap-2 text-xs">
        {avisoMissing}
        <span className="text-gray-500">Faturar?</span>
        <button onClick={runFaturar} disabled={pending}
          className="font-medium text-orange-600 hover:text-orange-700 inline-flex items-center gap-1 disabled:opacity-50">
          {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Sim'}
        </button>
        <button onClick={() => setMode(null)} className="text-gray-400 hover:text-gray-600">Não</button>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button onClick={() => setMode('faturar')}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 text-[#fff] text-xs font-medium rounded-lg hover:bg-orange-700 active:scale-[0.97] transition">
        <Receipt className="w-3.5 h-3.5" /> Faturar
      </button>
      {enviar && (
        <button onClick={() => { setDest(destinatarioPadrao ?? ''); setMode('enviar') }}
          title="Faturar e enviar o financeiro ao cliente por e-mail"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-orange-200 text-orange-700 text-xs font-medium rounded-lg hover:bg-orange-50 active:scale-[0.97] transition">
          <Send className="w-3.5 h-3.5" /> <span className="hidden sm:inline">e enviar</span>
        </button>
      )}
    </span>
  )
}
