'use client'

import { useEffect, useState, useTransition } from 'react'
import { BellRing, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { pushPublicKey, pushSubscribe } from '@/app/actions/push'
import { assinarPush, assinaturaAtual, detectarSuporte } from './push-client'

/** "Agora não" silencia o convite por este tempo (por aparelho). */
const SNOOZE_DIAS = 7
const SNOOZE_KEY = 'push-prompt-snooze'

/**
 * Convite ativo de push na home — o padrão da casa é TODO MUNDO com push
 * ligado, então o app pede em vez de esperar a pessoa achar o card no Perfil.
 * O navegador exige gesto pra permissão: o convite torna o sim um toque só.
 * Some sozinho quando: servidor sem chave, aparelho sem suporte, permissão
 * negada no SO, já assinado, ou "Agora não" recente. Desativar mora no Perfil.
 */
export function PushPrompt() {
  const [mostrar, setMostrar] = useState(false)
  const [chave, setChave] = useState<string | null>(null)
  const [pending, start] = useTransition()

  useEffect(() => {
    let vivo = true
    async function detectar() {
      try {
        const snooze = Number(localStorage.getItem(SNOOZE_KEY) ?? 0)
        if (Date.now() < snooze) return
        if (detectarSuporte() !== 'ok') return
        if (Notification.permission === 'denied') return
        const key = await pushPublicKey()
        if (!key || !vivo) return
        if (await assinaturaAtual()) return
        if (!vivo) return
        setChave(key)
        setMostrar(true)
      } catch { /* qualquer falha aqui só significa: não convidar agora */ }
    }
    detectar()
    return () => { vivo = false }
  }, [])

  if (!mostrar) return null

  function ativar() {
    start(async () => {
      try {
        const sub = await assinarPush(chave!)
        const r = await pushSubscribe(sub, navigator.userAgent)
        if (r?.error) { toast.error(r.error); return }
        setMostrar(false)
        toast.success('Notificações ativadas neste aparelho.')
      } catch {
        // Recusou o pedido de permissão (ou o navegador falhou): respeita e adia.
        adiar()
      }
    })
  }

  function adiar() {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DIAS * 86_400_000)) } catch {}
    setMostrar(false)
  }

  return (
    <div className="bg-white rounded-2xl border border-orange-200 p-4 mb-6 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center shrink-0">
          <BellRing className="w-4.5 h-4.5 text-orange-600" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">Ligue as notificações</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Menções, aprovações do cliente e o lembrete do ponto chegam mesmo com o app
            fechado. Dá para desativar no Perfil quando quiser.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button onClick={ativar} disabled={pending}
          className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 active:scale-[0.97] disabled:opacity-50 transition-colors">
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <BellRing className="w-4 h-4" />}
          Ativar
        </button>
        <button onClick={adiar} disabled={pending} title="Perguntar de novo em uma semana"
          className="inline-flex items-center justify-center h-10 w-10 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 active:scale-[0.97] transition-colors"
          aria-label="Agora não">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
