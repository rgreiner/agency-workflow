'use client'

/**
 * Miolo de assinatura de web-push compartilhado entre o card do Perfil
 * (PushSettings) e o convite da home (PushPrompt). A plataforma EXIGE gesto do
 * usuário pra pedir permissão — não existe "ligar sozinho"; o que dá pra fazer
 * é pedir ativamente e tornar o sim um toque só.
 */

export function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(b64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export type PushSuporte = 'ok' | 'ios-instalar' | 'sem-suporte'

export function detectarSuporte(): PushSuporte {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  const standalone = window.matchMedia('(display-mode: standalone)').matches
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return isIOS && !standalone ? 'ios-instalar' : 'sem-suporte'
  }
  return 'ok'
}

/** Assina o push neste aparelho (dispara o pedido de permissão do navegador). */
export async function assinarPush(chavePublica: string) {
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(chavePublica),
  })
  const json = sub.toJSON()
  return { endpoint: sub.endpoint, keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth } }
}

export async function assinaturaAtual(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}
