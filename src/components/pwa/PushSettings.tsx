'use client'

import { useEffect, useState, useTransition } from 'react'
import { Bell, BellOff, BellRing, Loader2, Share } from 'lucide-react'
import { toast } from 'sonner'
import { pushPublicKey, pushSubscribe, pushUnsubscribe } from '@/app/actions/push'

/**
 * Ativação de notificações push do aparelho (Perfil). Estados possíveis:
 *   indisponivel   — servidor sem chave VAPID (feature desligada) → não desenha
 *   sem-suporte    — navegador sem Push API
 *   ios-instalar   — iPhone/iPad no Safari SEM o app instalado (iOS só entrega
 *                    push pra PWA na tela inicial, 16.4+)
 *   negado         — permissão bloqueada no SO (só o usuário destrava)
 *   inativo/ativo  — o toggle de verdade
 */
type Estado = 'carregando' | 'indisponivel' | 'sem-suporte' | 'ios-instalar' | 'negado' | 'inativo' | 'ativo'

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(b64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export function PushSettings() {
  const [estado, setEstado] = useState<Estado>('carregando')
  const [chave, setChave] = useState<string | null>(null)
  const [pending, start] = useTransition()

  useEffect(() => {
    let vivo = true
    async function detectar() {
      const key = await pushPublicKey()
      if (!vivo) return
      if (!key) { setEstado('indisponivel'); return }
      setChave(key)

      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      const standalone = window.matchMedia('(display-mode: standalone)').matches
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setEstado(isIOS && !standalone ? 'ios-instalar' : 'sem-suporte')
        return
      }
      if (Notification.permission === 'denied') { setEstado('negado'); return }
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (vivo) setEstado(sub ? 'ativo' : 'inativo')
      } catch {
        if (vivo) setEstado('inativo')
      }
    }
    detectar()
    return () => { vivo = false }
  }, [])

  function ativar() {
    start(async () => {
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(chave!),
        })
        const json = sub.toJSON()
        const r = await pushSubscribe(
          { endpoint: sub.endpoint, keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth } },
          navigator.userAgent,
        )
        if (r?.error) { toast.error(r.error); return }
        setEstado('ativo')
        toast.success('Notificações ativadas neste aparelho.')
      } catch {
        if (Notification.permission === 'denied') setEstado('negado')
        else toast.error('Não deu para ativar as notificações. Tente de novo.')
      }
    })
  }

  function desativar() {
    start(async () => {
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (sub) {
          await pushUnsubscribe(sub.endpoint)
          await sub.unsubscribe()
        }
        setEstado('inativo')
        toast.success('Notificações desativadas neste aparelho.')
      } catch {
        toast.error('Não deu para desativar. Tente de novo.')
      }
    })
  }

  if (estado === 'carregando' || estado === 'indisponivel') return null

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
        <Bell className="w-4 h-4 text-orange-600" /> Notificações no celular
      </h2>
      <p className="text-xs text-gray-500 mt-1">
        Receba menções, comentários e o lembrete do ponto mesmo com o app fechado.
      </p>

      {estado === 'sem-suporte' && (
        <p className="text-xs text-gray-400 mt-3">Este navegador não suporta notificações push.</p>
      )}

      {estado === 'ios-instalar' && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mt-3 flex items-start gap-1.5">
          <Share className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            No iPhone, primeiro instale o Flow: toque em <b>Compartilhar</b> e depois em{' '}
            <b>Adicionar à Tela de Início</b>. Aí volte aqui para ativar.
          </span>
        </p>
      )}

      {estado === 'negado' && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mt-3">
          As notificações estão bloqueadas nas configurações do aparelho. Libere a permissão
          do Flow lá e recarregue esta página.
        </p>
      )}

      {estado === 'inativo' && (
        <button onClick={ativar} disabled={pending}
          className="mt-3 inline-flex items-center gap-2 px-4 py-2.5 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 active:scale-[0.97] disabled:opacity-50 transition-colors">
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <BellRing className="w-4 h-4" />}
          Ativar neste aparelho
        </button>
      )}

      {estado === 'ativo' && (
        <div className="mt-3 flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-lg px-2.5 py-1.5">
            <BellRing className="w-3.5 h-3.5" /> Ativas neste aparelho
          </span>
          <button onClick={desativar} disabled={pending}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 active:scale-[0.97] disabled:opacity-50 transition-colors">
            {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BellOff className="w-3.5 h-3.5" />}
            Desativar
          </button>
        </div>
      )}
    </div>
  )
}
