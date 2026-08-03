'use client'

import { useState, useEffect, useCallback, useTransition } from 'react'
import { Mail, Check, Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { enviarCodigo, confirmarEmailPessoal, statusEmailPessoal, type StatusEmailPessoal } from '@/app/actions/rh-otp'

/**
 * E-mail PESSOAL é pré-requisito da assinatura: é o segundo fator.
 * Corporativo não serve — quem administra o Workspace da empresa consegue ler,
 * então não provaria nada além do que a senha já prova.
 */
export function EmailPessoalCard({ orgSlug, colaboradorId, onPronto }: {
  orgSlug: string; colaboradorId: string; onPronto?: () => void
}) {
  const [st, setSt] = useState<StatusEmailPessoal | null>(null)
  const [email, setEmail] = useState('')
  const [codigo, setCodigo] = useState('')
  const [enviado, setEnviado] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const carregar = useCallback(async () => {
    const r = await statusEmailPessoal(orgSlug, colaboradorId)
    if (!r?.error) { setSt(r?.status ?? null); setEmail(r?.status?.email_pessoal ?? '') }
  }, [orgSlug, colaboradorId])

  useEffect(() => { carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  const verificado = !!st?.verificado_em

  function enviar() {
    start(async () => {
      const r = await enviarCodigo(orgSlug, colaboradorId, 'verificar_email', email)
      if (r?.error) toast.error(r.error)
      else { setEnviado(r.destino ?? null); toast.success('Código enviado.') }
    })
  }
  function confirmar() {
    start(async () => {
      const r = await confirmarEmailPessoal(orgSlug, colaboradorId, email, codigo)
      if (r?.error) toast.error(r.error)
      else { toast.success('E-mail pessoal verificado.'); setCodigo(''); setEnviado(null); carregar(); onPronto?.() }
    })
  }

  const inputCls = 'w-full px-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500'

  if (verificado) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-3 mb-5 flex items-center justify-between gap-3">
        <div className="text-sm text-gray-600 inline-flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          E-mail pessoal verificado: <b className="text-gray-800">{st?.email_pessoal}</b>
        </div>
        <button onClick={() => setSt(s => s ? { ...s, verificado_em: null } : s)}
          className="text-xs text-gray-400 hover:text-gray-700 transition">Trocar</button>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 mb-5">
      <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-1"><Mail className="w-4 h-4" /> E-mail pessoal</h2>
      <p className="text-xs text-gray-600 mb-3">
        Necessário para assinar. É para onde vai o código de confirmação. <b>Não use o e-mail da empresa</b> —
        ele é administrado pelo empregador, então não serviria como prova independente de que foi você.
      </p>
      <div className="flex flex-wrap gap-2">
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@gmail.com"
          className={`${inputCls} flex-1 min-w-[14rem] bg-white`} />
        <button onClick={enviar} disabled={pending || !email}
          className="px-3 py-2 text-sm font-medium rounded-xl bg-gray-900 text-[#fff] hover:bg-gray-800 disabled:opacity-50 transition whitespace-nowrap">
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : enviado ? 'Reenviar' : 'Enviar código'}
        </button>
      </div>
      {enviado && (
        <div className="flex flex-wrap gap-2 mt-3">
          <input value={codigo} onChange={e => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000" inputMode="numeric"
            className={`${inputCls} w-32 bg-white font-mono tracking-widest`} />
          <button onClick={confirmar} disabled={pending || codigo.length < 6}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl bg-orange-600 text-[#fff] hover:bg-orange-700 disabled:opacity-50 transition">
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Confirmar
          </button>
          <p className="w-full text-[11px] text-gray-500">Enviado para {enviado} — vale 10 minutos.</p>
        </div>
      )}
    </div>
  )
}
